import { getPackageDeployments } from './helpers/package-deployment.helper.js';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppointmentStatus, Prisma } from '@prisma/client';
import { isUuid } from '../../common/utils/staff.utils.js';
import { RabbitMqConfig } from '../../config/config.type.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { assertPatientSlotAvailable, releaseAppointmentSlot } from '../appointments/helpers/appointment.helper.js';
import { RecommendationService } from '../recommendations/recommendation.service.js';
import { releaseVoucherUsage, VoucherCalculationResult, VouchersService } from '../vouchers/vouchers.service.js';
import { AppointmentItemDto, BatchCheckoutDto, CheckoutAppointmentDto } from './dtos/checkout-appointment.dto.js';
import { assertBookingMethodSlot, assertPackageReception, PACKAGE_RECEPTION_SELECT } from './helpers/package-reception.helper.js';

import { MAX_BOOKING_DAYS, onlineBookingDateRange } from './helpers/booking-date.helper.js';
import { reserveBookingSlot } from './helpers/slot-reservation.helper.js';
import { randomUUID } from 'node:crypto';

const CHECKOUT_SLOT_SELECT = {
  id: true, isActive: true, slotStatus: true, startTime: true, endTime: true,
  schedule: { select: {
    branchId: true, workDate: true, status: true, doctorId: true,
    doctor: { select: {
      id: true, isActive: true, isOnlineConsultationEnabled: true,
      consultationFee: true, onlineConsultationFee: true, user: { select: { fullName: true } },
    } },
  } },
} satisfies Prisma.DoctorScheduleSlotSelect;
type CheckoutSlot = Prisma.DoctorScheduleSlotGetPayload<{ select: typeof CHECKOUT_SLOT_SELECT }>;
type PreparedBooking = {
  slot: CheckoutSlot | null;
  receptionSlot: Prisma.PackageReceptionSlotGetPayload<{ include: { receptionSchedule: true } }> | null;
  servicePackage: Prisma.ServicePackageGetPayload<{ select: typeof PACKAGE_RECEPTION_SELECT }> | null;
  bookingMethodId: number; price: Prisma.Decimal; branchId: number; workDate: Date;
};

const BOOKING_SERVICE_FEE = 10_000;

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
    private readonly recommendations: RecommendationService,
  ) { }
  async checkout(accountId: string, dto: CheckoutAppointmentDto, transaction?: Prisma.TransactionClient) {
    this.validateBookingItem(dto);
    try {
      const execute = async (tx: Prisma.TransactionClient) => {
        const profile = await tx.patientProfile.findFirst({
          where: { id: dto.patientProfileId, accountId }, select: { id: true },
        });
        if (!profile) throw new NotFoundException('Không tìm thấy hồ sơ bệnh nhân');
        const prepared = await this.prepareCheckoutItem(tx, dto);
        const { slot, receptionSlot, servicePackage, bookingMethodId, price, branchId } = prepared;
        await this.reservePrepared(tx, profile.id, prepared);
        const { now, expiresAt } = await this.getHoldWindow(tx);
        const pricing = await this.calculateCheckoutTotals(tx, accountId, Number(price), dto.voucherCode);
        const bookingOrder = await tx.bookingOrder.create({ data: {
          accountId, orderCode: `ORD-${randomUUID().replace(/-/g, '').slice(0, 24).toUpperCase()}`,
          groupType: 'SINGLE', totalAmount: new Prisma.Decimal(pricing.totalAmount),
        } });
        const appointment = await tx.appointment.create({
          data: {
            bookingOrderId: bookingOrder.id,
            patientProfileId: profile.id,
            bookingMethodId, scheduleSlotId: slot?.id, receptionSlotId: receptionSlot?.id,
            ...(servicePackage ? { servicePackageId: servicePackage.id } : {}),
            servicePrice: price, symptomsDescription: dto.symptomsDescription,
            bookedViaAi: dto.bookedViaAi ?? false, holdExpiresAt: expiresAt,
            statusHistories: { create: { toStatus: 'HOLD', actorId: accountId } },
          },
        });
        return this.completeSingleCheckout(tx, accountId, appointment, {
          branchId, orderCode: bookingOrder.orderCode, slotId: slot?.id ?? null, receptionSlotId: receptionSlot?.id, price, now, expiresAt,
        }, pricing);
      };
      return transaction ? await execute(transaction) : await this.prisma.$transaction(execute, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) { this.rethrowCheckoutError(error); }
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
      await releaseAppointmentSlot(tx, appointment.scheduleSlotId, appointment.receptionSlotId);

      await tx.appointmentStatusHistory.create({ data: { appointmentId, fromStatus: 'HOLD', toStatus: 'CANCELLED', reason: 'PAYMENT_HOLD_TIMEOUT' } });
      if (await tx.appointment.count({ where: { bookingOrderId: appointment.bookingOrderId, status: 'HOLD' } }) === 0) {
        await tx.paymentTransaction.updateMany({ where: { invoice: { bookingOrderId: appointment.bookingOrderId }, status: 'PENDING' }, data: { status: 'FAILED' } });
        await tx.invoice.updateMany({ where: { bookingOrderId: appointment.bookingOrderId, status: 'UNPAID' }, data: { status: 'CANCELLED' } });
        await tx.bookingOrder.updateMany({ where: { id: appointment.bookingOrderId, status: { in: ['UNPAID', 'PENDING_PAYMENT'] } }, data: { status: 'CANCELLED' } });
        await releaseVoucherUsage(tx, { bookingOrderId: appointment.bookingOrderId });
      }
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (expired) await this.recommendations.recordAbandonedBooking(appointmentId).catch(() => {});
    return expired;
  }

  // Hủy giữ chỗ của đơn lẻ hoặc đơn nhóm khi giao dịch chưa thanh toán bị hủy.
  async cancelUnpaidPayment(providerTransactionId: string, accountId: string) {
    const abandonedIds: string[] = [];
    const cancelled = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.paymentTransaction.findFirst({
        where: {
          ...(isUuid(providerTransactionId) ? { OR: [{ providerTransactionId }, { id: providerTransactionId }] } : { providerTransactionId }),
          invoice: { bookingOrder: { accountId } },
        },
        select: {
          id: true, invoiceId: true, status: true, paidAt: true, invoice: {
            select: {
              status: true, paidAt: true, bookingOrderId: true,
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
          status: 'HOLD', bookingOrderId: payment.invoice.bookingOrderId,
        },
        select: { id: true, scheduleSlotId: true, receptionSlotId: true },
        orderBy: { id: 'asc' },
      });
      for (const appointment of appointments) {
        const changed = await tx.appointment.updateMany({
          where: { id: appointment.id, status: 'HOLD' },
          data: { status: 'CANCELLED' },
        });
        if (!changed.count) continue;
        abandonedIds.push(appointment.id);
        await releaseAppointmentSlot(tx, appointment.scheduleSlotId, appointment.receptionSlotId);
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
      await releaseVoucherUsage(tx, { bookingOrderId: payment.invoice.bookingOrderId });
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await Promise.allSettled(abandonedIds.map(id => this.recommendations.recordAbandonedBooking(id)));
    return cancelled;
  }

  async batchCheckout(accountId: string, dto: BatchCheckoutDto) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Danh sách thành viên không được rỗng');
    }
    if (dto.items.length > 5) throw new BadRequestException('Đặt khám gia đình hỗ trợ tối đa 5 người.');
    if (new Set(dto.items.map(item => item.patientProfileId)).size !== dto.items.length) throw new BadRequestException('Mỗi người bệnh chỉ được chọn một lần trong đơn gia đình.');
    const groupType = dto.groupType ?? (dto.items.length === 1 ? 'SINGLE' : 'FAMILY');
    if (groupType === 'SINGLE' && dto.items.length !== 1) throw new BadRequestException('Đơn đặt lịch cá nhân chỉ được có một lịch khám.');
    for (const item of dto.items) this.validateBookingItem(item);

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
        const appointmentData: (Omit<Prisma.AppointmentUncheckedCreateInput, 'bookingOrderId'> & { branchId: number })[] = [];
        const bookingDates = new Set<string>();
        for (const item of dto.items) {
          const profile = profiles.find((p) => p.id === item.patientProfileId)!;
          const prepared = await this.prepareCheckoutItem(tx, item, profile.fullName);
          const { slot, receptionSlot, servicePackage, bookingMethodId, price, branchId, workDate } = prepared;
          bookingDates.add(workDate.toISOString().slice(0, 10));
          if (bookingDates.size > 1) throw new BadRequestException('Các thành viên trong đơn gia đình phải khám cùng ngày.');
          await this.reservePrepared(tx, profile.id, prepared, profile.fullName);
          totalAmount = totalAmount.add(price);
          appointmentData.push({
            patientProfileId: profile.id, branchId,
            bookingMethodId, scheduleSlotId: slot?.id, receptionSlotId: receptionSlot?.id,
            ...(servicePackage ? { servicePackageId: servicePackage.id } : {}),
            servicePrice: price, symptomsDescription: item.symptomsDescription,
            bookedViaAi: item.bookedViaAi ?? false, holdExpiresAt: expiresAt,
          });
        }

        const pricing = await this.calculateCheckoutTotals(tx, accountId, Number(totalAmount), dto.voucherCode);
        const { subtotal, serviceFee, discountAmount, totalAmount: finalTotalAmount, voucherApplied } = pricing;

        // Tạo BookingOrder tổng
        const orderCode = `ORD-${randomUUID().replace(/-/g, '').slice(0, 24).toUpperCase()}`;
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
        const appointments: Prisma.AppointmentGetPayload<{}>[] = [];
        for (const { branchId: _branchId, ...appt } of appointmentData) {
          appointments.push(await tx.appointment.create({
              data: {
                ...appt,
                bookingOrderId: bookingOrder.id,
                statusHistories: { create: { toStatus: 'HOLD', actorId: accountId } },
              },
            }));
        }

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
    } catch (error) { this.rethrowCheckoutError(error); }
  }
  private async assertBranchBookingMethod(tx: Prisma.TransactionClient, branchId: number, code: string) {
    const method = await tx.branchBookingMethod.findFirst({
      where: { branchId, isEnabled: true, branch: { isActive: true }, bookingMethod: { code, isActive: true } },
      select: { bookingMethodId: true },
    });
    if (!method) throw new BadRequestException('Cơ sở đã ngừng hoạt động hoặc không còn nhận hình thức khám đã chọn.');
    return method.bookingMethodId;
  }

  private async getHoldWindow(tx: Prisma.TransactionClient) {
    const holdTtlMs = this.config.getOrThrow<RabbitMqConfig>('rabbitmq').holdTtlMs;
    const [window] = await tx.$queryRaw<Array<{ now: Date; expiresAt: Date }>>`
      SELECT NOW() AS "now", NOW() + (${holdTtlMs} * INTERVAL '1 millisecond') AS "expiresAt"
    `;
    return window;
  }

  async calculateCheckoutTotals(tx: Prisma.TransactionClient, accountId: string, subtotal: number, voucherCode?: string): Promise<CheckoutPricing> {
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
  private async reserveForPatient(tx: Prisma.TransactionClient, profileId: string, slot: CheckoutSlot, patientName?: string) {
    await assertPatientSlotAvailable(tx, profileId, slot);
    if (await reserveBookingSlot(tx, slot.id) !== 1) {
      throw new ConflictException('Khung giờ khám vừa hết chỗ. Vui lòng chọn lại.' + (patientName ? ' (' + patientName + ')' : ''));
    }
  }
  private async reservePrepared(tx: Prisma.TransactionClient, profileId: string, prepared: PreparedBooking, patientName?: string) {
    if (prepared.slot) return this.reserveForPatient(tx, profileId, prepared.slot, patientName);
    const slot = prepared.receptionSlot!;
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${profileId}, 0))`;
    await assertPatientSlotAvailable(tx, profileId, { startTime: slot.startTime, endTime: slot.endTime, schedule: { workDate: slot.date } });
    const reserved = await tx.$executeRaw`UPDATE package_reception_slots SET occupied_count = occupied_count + 1, updated_at = NOW()
      WHERE id = ${slot.id} AND is_active = true AND occupied_count < capacity
        AND EXISTS (SELECT 1 FROM package_reception_schedules WHERE id = reception_schedule_id AND is_active = true)`;
    if (reserved !== 1) throw new ConflictException('Khung tiếp nhận vừa hết chỗ. Vui lòng chọn khung khác');
  }

  private async completeSingleCheckout(
    tx: Prisma.TransactionClient,
    accountId: string,
    appointment: { id: string; status: AppointmentStatus; bookingOrderId: string },
    details: { branchId: number; orderCode: string; slotId: number | null; receptionSlotId?: number; price: Prisma.Decimal; now: Date; expiresAt: Date },
    pricing: CheckoutPricing,
  ) {
    const { subtotal, serviceFee, discountAmount, totalAmount, voucherApplied } = pricing;
    const invoice = await tx.invoice.create({
      data: {
        bookingOrderId: appointment.bookingOrderId,
        issuedBranchId: details.branchId,
        subtotal: details.price,
        serviceFee: new Prisma.Decimal(serviceFee),
        discountAmount: new Prisma.Decimal(discountAmount),
        voucherCode: voucherApplied?.code ?? null,
        totalAmount: new Prisma.Decimal(totalAmount),
      },
    });
    if (voucherApplied && discountAmount > 0) {
      await this.vouchersService.recordVoucherUsage(tx, voucherApplied.id, accountId, discountAmount, { bookingOrderId: appointment.bookingOrderId });
    }
    const payment = await tx.paymentTransaction.create({
      data: {
        invoiceId: invoice.id, provider: 'PENDING_SELECTION',
        idempotencyKey: `checkout:${appointment.bookingOrderId}`, method: 'ONLINE', amount: invoice.totalAmount,
      },
    });
    await tx.outboxEvent.create({
      data: {
        aggregateType: 'Appointment', aggregateId: appointment.id, eventType: 'appointment.hold.created',
        payload: { appointmentId: appointment.id, doctorSlotId: details.slotId, receptionSlotId: details.receptionSlotId ?? null, holdExpiresAt: details.expiresAt.toISOString() },
      },
    });
    return {
      appointmentId: appointment.id, bookingOrderId: appointment.bookingOrderId, invoiceId: invoice.id, paymentId: payment.id, status: appointment.status,
      orderCode: details.orderCode, groupType: 'SINGLE' as const,
      holdStartedAt: details.now, holdExpiresAt: details.expiresAt, subtotal, serviceFee, discountAmount, totalAmount,
    };
  }
  private validateBookingLeadTime(examDate: Date) {
    onlineBookingDateRange(MAX_BOOKING_DAYS).resolveDate(examDate.toISOString().slice(0, 10));
  }

  private isDoctorBookingMethod(code: string): boolean {
    return code === 'CONSULTATION' || code === 'ONLINE_CONSULTATION';
  }

  private validateBookingMethodCode(code: string): void {
    if (!['SPECIALTY_EXAM', 'CONSULTATION', 'ONLINE_CONSULTATION', 'HEALTH_PACKAGE', 'AFTER_HOURS'].includes(code)) {
      throw new BadRequestException('Hình thức khám không hợp lệ');
    }
  }

  private validateBookingItem(item: AppointmentItemDto) {
    if (item.bookingMethodCode === 'HEALTH_PACKAGE') {
      if (!Number.isInteger(item.receptionSlotId) || item.receptionSlotId < 1 || item.scheduleSlotId) throw new BadRequestException('Vui lòng chọn khung tiếp nhận gói khám, không chọn lịch bác sĩ');
    } else if (!Number.isInteger(item.scheduleSlotId) || item.scheduleSlotId < 1 || item.receptionSlotId) throw new BadRequestException('Vui lòng chọn khung giờ khám đã được tạo sẵn');
    this.validateBookingMethodCode(item.bookingMethodCode);
    if (this.isDoctorBookingMethod(item.bookingMethodCode) && item.servicePackageId) {
      throw new BadRequestException('Dịch vụ khám phải được đặt bằng hình thức khám theo dịch vụ');
    }
  }

  private async prepareCheckoutItem(tx: Prisma.TransactionClient, item: AppointmentItemDto, patientName?: string): Promise<PreparedBooking> {
    const doctorBooking = this.isDoctorBookingMethod(item.bookingMethodCode);
    const suffix = patientName ? ' (' + patientName + ')' : '';
    if (!doctorBooking && !item.servicePackageId) throw new BadRequestException('Thiếu gói dịch vụ' + suffix);
    const servicePackage = doctorBooking ? null : await tx.servicePackage.findUnique({
      where: { id: item.servicePackageId! }, select: PACKAGE_RECEPTION_SELECT,
    });
    if (!doctorBooking && !servicePackage?.isActive) throw new NotFoundException('Gói dịch vụ không khả dụng' + suffix);
    if (item.bookingMethodCode === 'HEALTH_PACKAGE') {
      const receptionSlot = await tx.packageReceptionSlot.findUnique({ where: { id: item.receptionSlotId! }, include: { receptionSchedule: true } });
      if (!receptionSlot?.isActive || !receptionSlot.receptionSchedule.isActive || receptionSlot.receptionSchedule.servicePackageId !== servicePackage!.id) throw new BadRequestException('Khung tiếp nhận không thuộc gói khám hoặc đã ngừng hoạt động');
      this.validateBookingLeadTime(receptionSlot.date);
      const bookingMethodId = await this.assertBranchBookingMethod(tx, receptionSlot.receptionSchedule.branchId, 'HEALTH_PACKAGE');
      const deployments = getPackageDeployments(servicePackage!);
      if (!deployments.some(method => method?.isEnabled && method.branchId === receptionSlot.receptionSchedule.branchId && method.bookingMethodId === bookingMethodId)) throw new BadRequestException('Gói khám không được triển khai tại cơ sở đã chọn');
      assertPackageReception(servicePackage!.receptionSchedules, { startTime: receptionSlot.startTime, schedule: { branchId: receptionSlot.receptionSchedule.branchId, workDate: receptionSlot.date } });
      return { slot: null, receptionSlot, servicePackage, bookingMethodId, price: servicePackage!.price, branchId: receptionSlot.receptionSchedule.branchId, workDate: receptionSlot.date };
    }
    const slot = await tx.doctorScheduleSlot.findUnique({ where: { id: item.scheduleSlotId! }, select: CHECKOUT_SLOT_SELECT });
    if (!slot || !slot.isActive || slot.slotStatus !== 'AVAILABLE' || slot.schedule.status !== 'OPEN' || !slot.schedule.doctor.isActive) {
      throw new NotFoundException('Khung giờ của bác sĩ không khả dụng' + suffix);
    }
    if (item.bookingMethodCode === 'ONLINE_CONSULTATION' && !slot.schedule.doctor.isOnlineConsultationEnabled) {
      throw new BadRequestException('Bác sĩ hiện không nhận tư vấn trực tuyến.');
    }
    this.validateBookingLeadTime(slot.schedule.workDate);
    const bookingMethodId = await this.assertBranchBookingMethod(tx, slot.schedule.branchId, item.bookingMethodCode);
    if (servicePackage) {
      assertBookingMethodSlot(item.bookingMethodCode, slot);
      assertPackageReception(servicePackage.receptionSchedules, slot);
      const deployments = getPackageDeployments(servicePackage)
        .filter(method => method?.isEnabled && method.branchId === slot.schedule.branchId);
      if (!deployments.length) throw new ConflictException('Gói dịch vụ không được áp dụng hoặc đã bị tắt tại cơ sở này' + suffix);
      if (!deployments.some(method => method.bookingMethodId === bookingMethodId)) {
        throw new ConflictException('Gói dịch vụ không hỗ trợ hình thức khám đã chọn tại cơ sở này' + suffix);
      }
      if (servicePackage.specialtyId && !await tx.doctorSpecialty.count({
        where: { doctorId: slot.schedule.doctorId, specialtyId: servicePackage.specialtyId },
      })) throw new BadRequestException('Bác sĩ không thuộc chuyên khoa của gói dịch vụ' + suffix);
    }
    const price = servicePackage ? servicePackage.price : item.bookingMethodCode === 'ONLINE_CONSULTATION'
      ? slot.schedule.doctor.onlineConsultationFee ?? slot.schedule.doctor.consultationFee
      : slot.schedule.doctor.consultationFee;
    return { slot, receptionSlot: null, servicePackage, bookingMethodId, price, branchId: slot.schedule.branchId, workDate: slot.schedule.workDate };
  }

  private rethrowCheckoutError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
      const target = String(error.meta?.target ?? '');
      if (target.includes('appointments_one_pending_payment_per_patient')) {
        throw new ConflictException('Người bệnh đang có một lịch chờ thanh toán. Vui lòng hoàn tất thanh toán hoặc thử lại sau khi thời gian giữ chỗ kết thúc');
      }
      if (target.includes('appointments_no_patient_slot_overlap')) throw new ConflictException('Người bệnh đã có lịch hẹn trong khung giờ này');
      throw new ConflictException('Lịch khám vừa thay đổi hoặc bị trùng. Vui lòng tải lại và chọn lại khung giờ');
    }
    throw error;
  }

}
