import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppointmentStatus, Prisma } from '@prisma/client';
import { isUuid } from '../../common/utils/staff.utils.js';
import { RabbitMqConfig } from '../../config/config.type.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { assertPatientSlotAvailable, releaseAppointmentSlot } from '../appointments/helpers/appointment.helper.js';
import { BehaviorTelemetryService } from '../recommendations/services/behavior-telemetry.service.js';
import { SearchAnalyticsService } from '../search-analytics/search-analytics.service.js';
import { releaseVoucherUsage, VoucherCalculationResult, VouchersService } from '../vouchers/vouchers.service.js';
import { BatchCheckoutDto, CheckoutAppointmentDto } from './dtos/checkout-appointment.dto.js';
import { assertBookingMethodSlot, assertPackageReception, PACKAGE_RECEPTION_SELECT } from './helpers/package-reception.helper.js';

export const BOOKING_SERVICE_FEE = 10_000;

type CheckoutPricing = {
  subtotal: number;
  serviceFee: number;
  discountAmount: number;
  totalAmount: number;
  voucherApplied: VoucherCalculationResult['voucher'] | null;
};

@Injectable()
export class BookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly vouchersService: VouchersService,
    private readonly analytics: SearchAnalyticsService,
    private readonly behaviorTelemetry: BehaviorTelemetryService,
  ) { }



  // tạo lịch hẹn lẻ
  async checkout(accountId: string, dto: CheckoutAppointmentDto) {
    const slotId = dto.scheduleSlotId;
    if (!slotId || !isUuid(slotId)) throw new BadRequestException('Vui lòng chọn khung giờ khám đã được tạo sẵn');
    if (this.isDoctorBookingMethod(dto.bookingMethodCode) && dto.servicePackageId) {
      throw new BadRequestException('Dịch vụ khám phải được đặt bằng hình thức khám theo dịch vụ');
    }
    try {
      return await this.prisma.$transaction(async (tx) => {

        // 1. check profile
        const profile = await tx.patientProfile.findFirst({
          where: { id: dto.patientProfileId, accountId },
        });
        if (!profile) throw new NotFoundException('Không tìm thấy hồ sơ bệnh nhân');

        // 2. check booking method
        this.validateBookingMethodCode(dto.bookingMethodCode);
        const isDoctor = this.isDoctorBookingMethod(dto.bookingMethodCode);
        if (isDoctor) {
          const doctorSlot = await tx.doctorScheduleSlot.findUnique({
            where: { id: slotId },
            include: { schedule: { include: { doctor: { include: { user: { select: { fullName: true } } } } } } },
          });

          if (!doctorSlot || !doctorSlot.isActive || doctorSlot.slotStatus !== 'AVAILABLE' || doctorSlot.schedule.status !== 'OPEN' || !doctorSlot.schedule.doctor.isActive) throw new NotFoundException('Khung giờ của bác sĩ không khả dụng');
          this.validateBookingLeadTime(doctorSlot.schedule.workDate);
          await this.assertBranchBookingMethod(tx, doctorSlot.schedule.branchId, dto.bookingMethodCode);
          await assertPatientSlotAvailable(tx, profile.id, doctorSlot);
          const reserved = await this.reserveSlot(tx, doctorSlot.id);
          if (reserved !== 1) throw new ConflictException('Bác sĩ vừa hết chỗ trong khung giờ này');
          const { now, expiresAt } = await this.getHoldWindow(tx);
          const price = dto.bookingMethodCode === 'ONLINE_CONSULTATION'
            ? (doctorSlot.schedule.doctor.onlineConsultationFee ?? doctorSlot.schedule.doctor.consultationFee)
            : doctorSlot.schedule.doctor.consultationFee;
          const pricing = await this.calculateCheckoutTotals(tx, accountId, Number(price), dto.voucherCode);

          const bookingMethod = await tx.bookingMethod.findFirst({
            where: { code: dto.bookingMethodCode, isActive: true },
            select: { id: true },
          });
          if (!bookingMethod) throw new BadRequestException('Hình thức khám không khả dụng');

          const appointment = await tx.appointment.create({
            data: {
              patientProfileId: profile.id,
              branchId: doctorSlot.schedule.branchId,
              ...await this.analytics.attribution(tx, accountId, dto, { branchId: doctorSlot.schedule.branchId, doctorId: doctorSlot.schedule.doctor.id }),
              bookingMethodId: bookingMethod.id,
              scheduleSlotId: doctorSlot.id,
              servicePrice: price,
              symptomsDescription: dto.symptomsDescription,
              bookedViaAi: dto.bookedViaAi ?? false,
              holdExpiresAt: expiresAt,
              statusHistories: { create: { toStatus: 'HOLD', actorId: accountId } },
            },
          });

          return this.completeSingleCheckout(tx, accountId, appointment, {
            branchId: doctorSlot.schedule.branchId, slotId: doctorSlot.id, price,
            description: `Khám với ${doctorSlot.schedule.doctor.user?.fullName || 'bác sĩ'}`, now, expiresAt,
          }, pricing);
        }

        if (!dto.servicePackageId) throw new BadRequestException('Thiếu gói dịch vụ');

        const servicePackage = await tx.servicePackage.findUnique({
          where: { id: dto.servicePackageId },
          select: PACKAGE_RECEPTION_SELECT,
        });
        if (!servicePackage || !servicePackage.isActive) {
          throw new NotFoundException('Gói dịch vụ không khả dụng');
        }

        const doctorSlot = await tx.doctorScheduleSlot.findUnique({
          where: { id: slotId },
          include: { schedule: { include: { doctor: true, room: true } } },
        });
        if (!doctorSlot || !doctorSlot.isActive || doctorSlot.slotStatus !== 'AVAILABLE' || doctorSlot.schedule.status !== 'OPEN' || !doctorSlot.schedule.doctor.isActive) {
          throw new NotFoundException('Khung giờ của bác sĩ không khả dụng');
        }
        this.validateBookingLeadTime(doctorSlot.schedule.workDate);
        await this.assertBranchBookingMethod(tx, doctorSlot.schedule.branchId, dto.bookingMethodCode);

        assertBookingMethodSlot(dto.bookingMethodCode, doctorSlot);
        assertPackageReception(servicePackage.receptionSchedules, doctorSlot);
        const targetBranchId = doctorSlot.schedule.branchId;
        const validBranchBbm =
          (servicePackage.branchBookingMethod?.branchId === targetBranchId && servicePackage.branchBookingMethod?.isEnabled)
            ? servicePackage.branchBookingMethod
            : servicePackage.branchBookingMethods?.find(
              (l) => l.branchBookingMethod?.branchId === targetBranchId && l.branchBookingMethod?.isEnabled,
            )?.branchBookingMethod;

        if (!validBranchBbm) {
          throw new ConflictException('Gói dịch vụ không được áp dụng hoặc đã bị tắt tại cơ sở này');
        }

        if (servicePackage.specialtyId) {
          const compatible = await tx.doctorSpecialty.count({
            where: { doctorId: doctorSlot.schedule.doctorId, specialtyId: servicePackage.specialtyId },
          });
          if (!compatible) throw new BadRequestException('Bác sĩ không thuộc chuyên khoa của gói dịch vụ');
        }

        await assertPatientSlotAvailable(tx, profile.id, doctorSlot);

        const reserved = await this.reserveSlot(tx, doctorSlot.id);
        if (reserved !== 1) throw new ConflictException('Bác sĩ đã hết chỗ trong khung giờ đã chọn. Vui lòng chọn lại.');

        const { now, expiresAt } = await this.getHoldWindow(tx);

        const pricing = await this.calculateCheckoutTotals(tx, accountId, Number(servicePackage.price), dto.voucherCode);

        const packageBookingMethod = await tx.bookingMethod.findFirst({
          where: { code: dto.bookingMethodCode, isActive: true },
          select: { id: true },
        });
        if (!packageBookingMethod) throw new BadRequestException('Hình thức khám không khả dụng');
        const supportsRequestedMethod =
          (validBranchBbm?.bookingMethodId === packageBookingMethod.id) ||
          servicePackage.branchBookingMethods?.some(
            (link) =>
              link.branchBookingMethod?.branchId === targetBranchId &&
              link.branchBookingMethod?.isEnabled &&
              link.branchBookingMethod?.bookingMethodId === packageBookingMethod.id,
          );
        if (!supportsRequestedMethod) {
          throw new ConflictException('Gói dịch vụ không hỗ trợ hình thức khám đã chọn tại cơ sở này');
        }


        // tạo lịch hẹn với status HOLD
        const appointment = await tx.appointment.create({
          data: {
            patientProfileId: profile.id,
            branchId: targetBranchId,
            ...await this.analytics.attribution(tx, accountId, dto, { branchId: targetBranchId, packageId: dto.servicePackageId }),
            bookingMethodId: packageBookingMethod.id,
            scheduleSlotId: doctorSlot.id,
            servicePackageId: servicePackage.id,
            servicePrice: servicePackage.price,
            symptomsDescription: dto.symptomsDescription,
            bookedViaAi: dto.bookedViaAi ?? false,
            holdExpiresAt: expiresAt,
            statusHistories: { create: { toStatus: 'HOLD', actorId: accountId } },
          },
        });

        return this.completeSingleCheckout(tx, accountId, appointment, {
          branchId: targetBranchId, slotId: doctorSlot.id, price: servicePackage.price,
          description: servicePackage.name, now, expiresAt,
        }, pricing);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
        const target = String(error.meta?.target ?? '');
        if (target.includes('appointments_one_pending_payment_per_patient')) {
          throw new ConflictException(
            'Người bệnh đang có một lịch chờ thanh toán. Vui lòng hoàn tất thanh toán hoặc thử lại sau khi thời gian giữ chỗ kết thúc',
          );
        }
        if (target.includes('appointments_no_patient_slot_overlap')) {
          throw new ConflictException('Người bệnh đã có lịch hẹn trong khung giờ này');
        }
        throw new ConflictException('Không thể tạo thêm lịch hẹn do thông tin bị trùng');
      }
      throw error;
    }
  }

  // Hủy lịch HOLD đã hết hạn sau khi đối soát thanh toán.
  async expireHold(appointmentId: string): Promise<boolean> {
    const expired = await this.prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.findUnique({ where: { id: appointmentId } });
      if (!appointment) return false;
      const changed = await tx.appointment.updateMany({
        where: { id: appointmentId, status: 'HOLD', holdExpiresAt: { lte: new Date() } },
        data: { status: 'CANCELLED' },
      });
      if (changed.count !== 1) return false;
      await releaseAppointmentSlot(tx, appointment.scheduleSlotId);

      await tx.paymentTransaction.updateMany({ where: { invoice: { appointmentId }, status: 'PENDING' }, data: { status: 'FAILED' } });
      await tx.appointmentStatusHistory.create({ data: { appointmentId, fromStatus: 'HOLD', toStatus: 'CANCELLED', reason: 'PAYMENT_HOLD_TIMEOUT' } });
      if (!appointment.bookingOrderId || await tx.appointment.count({ where: { bookingOrderId: appointment.bookingOrderId, status: 'HOLD' } }) === 0) {
        await releaseVoucherUsage(tx, appointment.bookingOrderId ? { bookingOrderId: appointment.bookingOrderId } : { appointmentId });
      }
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (expired) await this.behaviorTelemetry?.recordAbandonedBooking(appointmentId).catch(() => {});
    return expired;
  }

  // Hủy giữ chỗ của đơn lẻ hoặc đơn nhóm khi giao dịch chưa thanh toán bị hủy.
  async cancelUnpaidPayment(providerTransactionId: string, accountId: string) {
    const abandonedIds: string[] = [];
    const cancelled = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.paymentTransaction.findFirst({
        where: {
          providerTransactionId,
          invoice: {
            OR: [
              { appointment: { patientProfile: { accountId } } },
              { bookingOrder: { accountId } },
            ]
          },
        },
        select: {
          id: true, invoiceId: true, status: true, paidAt: true, invoice: {
            select: {
              status: true, paidAt: true, appointmentId: true, bookingOrderId: true,
              payments: { where: { paidAt: { not: null } }, select: { id: true }, take: 1 },
            },
          }
        },
      });
      if (!payment) throw new NotFoundException('Không tìm thấy giao dịch thanh toán');
      if (payment.paidAt || payment.invoice.paidAt || payment.invoice.payments.length
        || payment.invoice.status === 'PAID' || payment.status === 'SUCCESS') return false;

      const appointments = await tx.appointment.findMany({
        where: {
          status: 'HOLD', ...(payment.invoice.bookingOrderId
            ? { bookingOrderId: payment.invoice.bookingOrderId }
            : { id: payment.invoice.appointmentId! })
        },
        select: { id: true, scheduleSlotId: true },
        orderBy: { id: 'asc' },
      });
      for (const appointment of appointments) {
        const changed = await tx.appointment.updateMany({
          where: { id: appointment.id, status: 'HOLD' },
          data: { status: 'CANCELLED' },
        });
        if (!changed.count) continue;
        abandonedIds.push(appointment.id);
        await releaseAppointmentSlot(tx, appointment.scheduleSlotId);
        await tx.appointmentStatusHistory.create({
          data: {
            appointmentId: appointment.id, fromStatus: 'HOLD', toStatus: 'CANCELLED',
            actorId: accountId, reason: 'PAYMENT_CANCELLED',
          }
        });
      }
      await tx.paymentTransaction.updateMany({
        where: { invoiceId: payment.invoiceId, status: 'PENDING' }, data: { status: 'CANCELLED' },
      });
      await tx.invoice.updateMany({
        where: { id: payment.invoiceId, status: 'UNPAID', paidAt: null }, data: { status: 'CANCELLED' },
      });
      if (payment.invoice.bookingOrderId) {
        await tx.bookingOrder.updateMany({
          where: { id: payment.invoice.bookingOrderId, status: { in: ['UNPAID', 'PENDING_PAYMENT'] } },
          data: { status: 'CANCELLED' },
        });
      }
      await releaseVoucherUsage(tx, payment.invoice.bookingOrderId ? { bookingOrderId: payment.invoice.bookingOrderId } : { appointmentId: payment.invoice.appointmentId! });
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await Promise.allSettled(abandonedIds.map(id => this.behaviorTelemetry?.recordAbandonedBooking(id)));
    return cancelled;
  }

  async batchCheckout(accountId: string, dto: BatchCheckoutDto) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Danh sách thành viên không được rỗng');
    }
    if (dto.items.length > 5) throw new BadRequestException('Đặt khám gia đình hỗ trợ tối đa 5 người.');
    if (new Set(dto.items.map(item => item.patientProfileId)).size !== dto.items.length) throw new BadRequestException('Mỗi người bệnh chỉ được chọn một lần trong đơn gia đình.');
    const groupType = dto.groupType ?? (dto.items.length === 1 ? 'SINGLE' : 'FAMILY');
    for (const item of dto.items) {
      if (!item.scheduleSlotId || !isUuid(item.scheduleSlotId)) {
        throw new BadRequestException('Vui lòng chọn khung giờ khám đã được tạo sẵn cho từng thành viên');
      }
      if (this.isDoctorBookingMethod(item.bookingMethodCode) && item.servicePackageId) {
        throw new BadRequestException('Dịch vụ khám phải được đặt bằng hình thức khám theo dịch vụ');
      }
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Xác minh tất cả profiles thuộc account
        const profileIds = dto.items.map((i) => i.patientProfileId);
        const profiles = await tx.patientProfile.findMany({
          where: { id: { in: profileIds }, accountId },
          select: { id: true, fullName: true },
        });
        if (profiles.length !== dto.items.length) {
          throw new NotFoundException('Một hoặc nhiều hồ sơ bệnh nhân không hợp lệ');
        }

        const { now, expiresAt } = await this.getHoldWindow(tx);

        let totalAmount = new Prisma.Decimal(0);
        const appointmentData: Prisma.AppointmentUncheckedCreateInput[] = [];
        const invoiceItems: Prisma.InvoiceItemCreateWithoutInvoiceInput[] = [];

        const bookingDates = new Set<string>();
        // Xử lý từng thành viên tuần tự trong cùng transaction.
        for (const item of dto.items) {
          const profile = profiles.find((p) => p.id === item.patientProfileId)!;

          this.validateBookingMethodCode(item.bookingMethodCode);
          const isDoctorBooking = this.isDoctorBookingMethod(item.bookingMethodCode);
          if (isDoctorBooking) {
            // ── Đặt theo bác sĩ ──────────────────────────────────
            const doctorSlot = await tx.doctorScheduleSlot.findUnique({
              where: { id: item.scheduleSlotId },
              include: { schedule: { include: { doctor: { include: { user: { select: { fullName: true } } } } } } },
            });
            if (!doctorSlot || !doctorSlot.isActive || doctorSlot.slotStatus !== 'AVAILABLE' || doctorSlot.schedule.status !== 'OPEN' || !doctorSlot.schedule.doctor.isActive) {
              throw new NotFoundException(`Khung giờ bác sĩ không khả dụng cho ${profile.fullName}`);
            }
            this.validateBookingLeadTime(doctorSlot.schedule.workDate);
            bookingDates.add(doctorSlot.schedule.workDate.toISOString().slice(0, 10));
            if (bookingDates.size > 1) throw new BadRequestException('Các thành viên trong đơn gia đình phải khám cùng ngày.');
            await this.assertBranchBookingMethod(tx, doctorSlot.schedule.branchId, item.bookingMethodCode);

            // Duplicate check
            await assertPatientSlotAvailable(tx, profile.id, doctorSlot);

            // Atomic lock slot
            const reserved = await this.reserveSlot(tx, doctorSlot.id);
            if (reserved !== 1) throw new ConflictException(`Bác sĩ vừa hết chỗ trong khung giờ này (${profile.fullName})`);

            const doctorMethod = await tx.bookingMethod.findFirst({
              where: { code: item.bookingMethodCode, isActive: true },
              select: { id: true },
            });
            if (!doctorMethod) throw new BadRequestException('Hình thức khám không khả dụng');

            const price = item.bookingMethodCode === 'ONLINE_CONSULTATION'
              ? (doctorSlot.schedule.doctor.onlineConsultationFee ?? doctorSlot.schedule.doctor.consultationFee)
              : doctorSlot.schedule.doctor.consultationFee;
            totalAmount = totalAmount.add(price);
            appointmentData.push({
              patientProfileId: profile.id,
              branchId: doctorSlot.schedule.branchId,
              ...await this.analytics.attribution(tx, accountId, item, { branchId: doctorSlot.schedule.branchId, doctorId: doctorSlot.schedule.doctor.id }),
              bookingMethodId: doctorMethod.id,
              scheduleSlotId: doctorSlot.id,
              servicePrice: price,
              symptomsDescription: item.symptomsDescription,
              bookedViaAi: item.bookedViaAi ?? false,
              holdExpiresAt: expiresAt,
            });
            invoiceItems.push({
              description: `Khám với ${doctorSlot.schedule.doctor.user?.fullName || 'bác sĩ'} – ${profile.fullName}`,
              quantity: 1,
              unitPrice: price,
              amount: price,
            });
          } else {
            // ── Đặt theo gói dịch vụ ─────────────────────────────
            if (!item.servicePackageId) {
              throw new BadRequestException(`Thiếu gói dịch vụ cho ${profile.fullName}`);
            }
            const slotId = item.scheduleSlotId;
            const pkg = await tx.servicePackage.findUnique({
              where: { id: item.servicePackageId },
              select: PACKAGE_RECEPTION_SELECT,
            });
            if (!pkg || !pkg.isActive) {
              throw new NotFoundException(`Gói dịch vụ không khả dụng cho ${profile.fullName}`);
            }

            const doctorSlot = await tx.doctorScheduleSlot.findUnique({
              where: { id: slotId },
              include: { schedule: { include: { doctor: true } } },
            });
            if (!doctorSlot || !doctorSlot.isActive || doctorSlot.slotStatus !== 'AVAILABLE' || doctorSlot.schedule.status !== 'OPEN') {
              throw new NotFoundException(`Khung giờ khám không khả dụng cho ${profile.fullName}`);
            }
            if (!doctorSlot.schedule.doctor.isActive) {
              throw new NotFoundException(`Bác sĩ không khả dụng cho ${profile.fullName}`);
            }
            this.validateBookingLeadTime(doctorSlot.schedule.workDate);
            bookingDates.add(doctorSlot.schedule.workDate.toISOString().slice(0, 10));
            if (bookingDates.size > 1) throw new BadRequestException('Các thành viên trong đơn gia đình phải khám cùng ngày.');
            await this.assertBranchBookingMethod(tx, doctorSlot.schedule.branchId, item.bookingMethodCode);

            if (pkg.specialtyId) {
              const compatible = await tx.doctorSpecialty.count({
                where: { doctorId: doctorSlot.schedule.doctorId, specialtyId: pkg.specialtyId },
              });
              if (!compatible) throw new BadRequestException(`Bác sĩ không thuộc chuyên khoa của dịch vụ (${profile.fullName})`);
            }

            assertBookingMethodSlot(item.bookingMethodCode, doctorSlot);
            assertPackageReception(pkg.receptionSchedules, doctorSlot);
            const targetBranchId = doctorSlot.schedule.branchId;
            const validBranchBbm =
              (pkg.branchBookingMethod?.branchId === targetBranchId && pkg.branchBookingMethod?.isEnabled)
                ? pkg.branchBookingMethod
                : pkg.branchBookingMethods?.find(
                  (l) => l.branchBookingMethod?.branchId === targetBranchId && l.branchBookingMethod?.isEnabled,
                )?.branchBookingMethod;

            if (!validBranchBbm) {
              throw new ConflictException(`Gói dịch vụ đã bị tắt hoặc không áp dụng tại cơ sở này (${profile.fullName})`);
            }

            await assertPatientSlotAvailable(tx, profile.id, doctorSlot);

            const reserved = await this.reserveSlot(tx, doctorSlot.id);
            if (reserved !== 1) throw new ConflictException(`Khung giờ khám hết chỗ (${profile.fullName})`);

            const packageMethod = await tx.bookingMethod.findFirst({
              where: { code: item.bookingMethodCode, isActive: true },
              select: { id: true },
            });
            if (!packageMethod) throw new BadRequestException('Hình thức khám không khả dụng');
            const supportsRequestedMethod =
              (validBranchBbm?.bookingMethodId === packageMethod.id) ||
              pkg.branchBookingMethods?.some(
                (link) =>
                  link.branchBookingMethod?.branchId === targetBranchId &&
                  link.branchBookingMethod?.isEnabled &&
                  link.branchBookingMethod?.bookingMethodId === packageMethod.id,
              );
            if (!supportsRequestedMethod) {
              throw new ConflictException(`Gói dịch vụ không hỗ trợ hình thức khám đã chọn (${profile.fullName})`);
            }

            totalAmount = totalAmount.add(pkg.price);
            appointmentData.push({
              patientProfileId: profile.id,
              branchId: targetBranchId,
              ...await this.analytics.attribution(tx, accountId, item, { branchId: targetBranchId, packageId: pkg.id }),
              bookingMethodId: packageMethod.id,
              scheduleSlotId: doctorSlot.id,
              servicePackageId: pkg.id,
              servicePrice: pkg.price,
              symptomsDescription: item.symptomsDescription,
              bookedViaAi: item.bookedViaAi ?? false,
              holdExpiresAt: expiresAt,
            });
            invoiceItems.push({
              description: `${pkg.name} – ${profile.fullName}`,
              quantity: 1,
              unitPrice: pkg.price,
              amount: pkg.price,
            });
          }
        }

        const pricing = await this.calculateCheckoutTotals(tx, accountId, Number(totalAmount), dto.voucherCode);
        const { subtotal, serviceFee, discountAmount, totalAmount: finalTotalAmount, voucherApplied } = pricing;

        this.appendCheckoutCharges(invoiceItems, pricing, 'Phí tiện ích dịch vụ (Ưu đãi đơn nhóm)');

        // Tạo BookingOrder tổng
        const orderCode = `ORD-${Date.now().toString(36).toUpperCase()}`;
        const branchIds = new Set(appointmentData.map((item) => item.branchId));
        if (branchIds.size > 1) {
          throw new BadRequestException('Các thành viên trong một đơn gia đình phải khám cùng cơ sở');
        }
        const branchId = appointmentData[0]?.branchId;
        const bookingOrder = await tx.bookingOrder.create({
          data: {
            accountId,
            orderCode,
            groupType,
            totalAmount: new Prisma.Decimal(finalTotalAmount),
            note: dto.note,
          },
        });

        // Tạo tất cả Appointment
        const appointments = await Promise.all(
          appointmentData.map((appt) =>
            tx.appointment.create({
              data: {
                ...appt,
                bookingOrderId: bookingOrder.id,
                statusHistories: { create: { toStatus: 'HOLD', actorId: accountId } },
              },
            }),
          ),
        );

        // 1 Invoice duy nhất cho toàn đơn
        const invoice = await tx.invoice.create({
          data: {
            bookingOrderId: bookingOrder.id,
            issuedBranchId: branchId,
            subtotal: new Prisma.Decimal(subtotal),
            serviceFee: new Prisma.Decimal(serviceFee),
            discountAmount: new Prisma.Decimal(discountAmount),
            voucherCode: voucherApplied?.code ?? null,
            totalAmount: new Prisma.Decimal(finalTotalAmount),
            items: { create: invoiceItems },
          },
        });

        if (voucherApplied && discountAmount > 0) {
          await this.vouchersService.recordVoucherUsage(tx, voucherApplied.id, accountId, discountAmount, { bookingOrderId: bookingOrder.id });
        }

        const payment = await tx.paymentTransaction.create({
          data: {
            invoiceId: invoice.id,
            provider: 'PENDING_SELECTION',
            idempotencyKey: `checkout:${bookingOrder.id}`,
            method: 'ONLINE',
            amount: new Prisma.Decimal(finalTotalAmount),
          },
        });

        await tx.outboxEvent.create({
          data: {
            aggregateType: 'BookingOrder',
            aggregateId: bookingOrder.id,
            eventType: 'booking_order.hold.created',
            payload: { bookingOrderId: bookingOrder.id, appointmentIds: appointments.map((a) => a.id), holdExpiresAt: expiresAt.toISOString() },
          },
        });

        return {
          bookingOrderId: bookingOrder.id,
          orderCode,
          invoiceId: invoice.id,
          paymentId: payment.id,
          subtotal,
          serviceFee,
          discountAmount,
          totalAmount: finalTotalAmount,
          groupType,
          holdStartedAt: now,
          holdExpiresAt: expiresAt,
          appointments: appointments.map((a) => ({ appointmentId: a.id, patientProfileId: a.patientProfileId, status: a.status })),
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Lịch hẹn bị trùng. Vui lòng chọn lại khung giờ');
      }
      throw error;
    }
  }

  private async assertBranchBookingMethod(tx: Prisma.TransactionClient, branchId: string, code: string) {
    const method = await tx.branchBookingMethod.findFirst({
      where: { branchId, isEnabled: true, branch: { isActive: true }, bookingMethod: { code, isActive: true } },
      select: { id: true },
    });
    if (!method) throw new BadRequestException('Cơ sở đã ngừng hoạt động hoặc không còn nhận hình thức khám đã chọn.');
  }

  private async getHoldWindow(tx: Prisma.TransactionClient) {
    const holdTtlMs = this.config.getOrThrow<RabbitMqConfig>('rabbitmq').holdTtlMs;
    const [window] = await tx.$queryRaw<Array<{ now: Date; expiresAt: Date }>>`
      SELECT NOW() AS "now", NOW() + (${holdTtlMs} * INTERVAL '1 millisecond') AS "expiresAt"
    `;
    return window;
  }

  private async calculateCheckoutTotals(tx: Prisma.TransactionClient, accountId: string, subtotal: number, voucherCode?: string): Promise<CheckoutPricing> {
    const serviceFee = BOOKING_SERVICE_FEE;
    const voucherResult = voucherCode
      ? await this.vouchersService.validateVoucher(voucherCode, subtotal, accountId, tx)
      : null;
    const discountAmount = voucherResult?.discountAmount ?? 0;
    return {
      subtotal, serviceFee, discountAmount,
      totalAmount: Math.max(0, subtotal + serviceFee - discountAmount),
      voucherApplied: voucherResult?.voucher ?? null,
    };
  }

  private reserveSlot(tx: Prisma.TransactionClient, slotId: string) {
    return tx.$executeRaw`
      UPDATE "doctor_schedule_slots"
      SET "occupied_count" = "occupied_count" + 1, "updated_at" = NOW()
      WHERE "id" = ${slotId}::uuid AND "is_active" = TRUE AND "slot_status" = 'AVAILABLE' AND "occupied_count" < "capacity"
    `;
  }

  private appendCheckoutCharges(
    items: Prisma.InvoiceItemCreateWithoutInvoiceInput[],
    pricing: CheckoutPricing,
    feeDescription = 'Phí tiện ích dịch vụ',
  ) {
    items.push({
      description: feeDescription, quantity: 1,
      unitPrice: new Prisma.Decimal(pricing.serviceFee), amount: new Prisma.Decimal(pricing.serviceFee),
    });
    if (pricing.discountAmount > 0 && pricing.voucherApplied) {
      items.push({
        description: `Mã ưu đãi (${pricing.voucherApplied.code})`, quantity: 1,
        unitPrice: new Prisma.Decimal(-pricing.discountAmount), amount: new Prisma.Decimal(-pricing.discountAmount),
      });
    }
  }

  private async completeSingleCheckout(
    tx: Prisma.TransactionClient,
    accountId: string,
    appointment: { id: string; status: AppointmentStatus },
    details: { branchId: string; slotId: string; price: Prisma.Decimal; description: string; now: Date; expiresAt: Date },
    pricing: CheckoutPricing,
  ) {
    const { subtotal, serviceFee, discountAmount, totalAmount, voucherApplied } = pricing;
    const invoiceItems: Prisma.InvoiceItemCreateWithoutInvoiceInput[] = [{
      description: details.description, quantity: 1, unitPrice: details.price, amount: details.price,
    }];
    this.appendCheckoutCharges(invoiceItems, pricing);
    const invoice = await tx.invoice.create({
      data: {
        appointmentId: appointment.id,
        issuedBranchId: details.branchId,
        subtotal: details.price,
        serviceFee: new Prisma.Decimal(serviceFee),
        discountAmount: new Prisma.Decimal(discountAmount),
        voucherCode: voucherApplied?.code ?? null,
        totalAmount: new Prisma.Decimal(totalAmount),
        items: { create: invoiceItems },
      },
    });
    if (voucherApplied && discountAmount > 0) {
      await this.vouchersService.recordVoucherUsage(tx, voucherApplied.id, accountId, discountAmount, { appointmentId: appointment.id });
    }
    const payment = await tx.paymentTransaction.create({
      data: {
        invoiceId: invoice.id, provider: 'PENDING_SELECTION',
        idempotencyKey: `checkout:${appointment.id}`, method: 'ONLINE', amount: invoice.totalAmount,
      },
    });
    await tx.outboxEvent.create({
      data: {
        aggregateType: 'Appointment', aggregateId: appointment.id, eventType: 'appointment.hold.created',
        payload: { appointmentId: appointment.id, doctorSlotId: details.slotId, holdExpiresAt: details.expiresAt.toISOString() },
      },
    });
    return {
      appointmentId: appointment.id, invoiceId: invoice.id, paymentId: payment.id, status: appointment.status,
      holdStartedAt: details.now, holdExpiresAt: details.expiresAt, subtotal, serviceFee, discountAmount, totalAmount,
    };
  }
  private validateBookingLeadTime(examDate: Date) {
    const nowUtc = new Date();
    const vnOffsetMs = 7 * 60 * 60 * 1000;
    const nowVn = new Date(nowUtc.getTime() + vnOffsetMs);
    const currentHour = nowVn.getUTCHours();
    const currentMinute = nowVn.getUTCMinutes();

    const todayVnStr = nowVn.toISOString().slice(0, 10);
    const baseDate = new Date(`${todayVnStr}T00:00:00.000Z`);
    const examDateStr = examDate.toISOString().slice(0, 10);
    const examDateOnly = new Date(`${examDateStr}T00:00:00.000Z`);

    const diffDays = Math.round((examDateOnly.getTime() - baseDate.getTime()) / (24 * 60 * 60 * 1000));

    if (diffDays < 1) {
      throw new BadRequestException(
        'Hệ thống không nhận đặt lịch trực tuyến trong ngày. Để khám trong ngày hôm nay, quý khách vui lòng đến trực tiếp phòng khám để lấy số thứ tự tại quầy tiếp đón.',
      );
    }

    if (diffDays > 30) {
      throw new BadRequestException(
        'Hệ thống chỉ mở đặt lịch trực tuyến trước tối đa 30 ngày.',
      );
    }

    if (diffDays === 1) {
      const isPastCutoff = currentHour > 16 || (currentHour === 16 && currentMinute >= 30);
      if (isPastCutoff) {
        throw new BadRequestException(
          'Để khám vào ngày mai, quý khách vui lòng hoàn tất đặt lịch trước 16h30 hôm nay. Quý khách vui lòng chọn ngày khám khác hoặc đến lấy số trực tiếp tại quầy tiếp đón.',
        );
      }
    }
  }

  private isDoctorBookingMethod(code: string): boolean {
    return code === 'CONSULTATION' || code === 'ONLINE_CONSULTATION';
  }

  private validateBookingMethodCode(code: string): void {
    if (!['SPECIALTY_EXAM', 'CONSULTATION', 'ONLINE_CONSULTATION', 'HEALTH_PACKAGE', 'AFTER_HOURS'].includes(code)) {
      throw new BadRequestException('Hình thức khám không hợp lệ');
    }
  }

}
