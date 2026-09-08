import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppointmentStatus, PaymentStatus, Prisma } from '@prisma/client';
import { createHash, createHmac } from 'crypto';
import { RabbitMqConfig } from '../../config/config.type.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { MailsService } from '../mails/mails.service.js';
import { VouchersService } from '../vouchers/vouchers.service.js';
import { AppointmentItemDto, BatchCheckoutDto, CheckoutAppointmentDto } from './dtos/checkout-appointment.dto.js';
import { PaymentWebhookDto } from './dtos/payment-webhook.dto.js';
import { RescheduleAppointmentDto } from './dtos/reschedule-appointment.dto.js';
import { RealtimeGateway } from '../../infrastructure/realtime/realtime.gateway.js';

const ACTIVE_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  'PENDING_PAYMENT', 'BOOKED', 'CHECKED_IN',
];

export const BOOKING_SERVICE_FEE = 10_000;

@Injectable()
export class BookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mailsService: MailsService,
    private readonly vouchersService: VouchersService,
    private readonly realtimeGateway: RealtimeGateway,
  ) {}


  public checkInToken(appointmentId: string) {
    const secret = this.config.get<string>('auth.secret');
    if (!secret) throw new Error('Thiếu AUTH_JWT_SECRET để phát hành QR check-in');
    return createHmac('sha256', secret).update(`check-in:${appointmentId}`).digest('base64url');
  }

  /**
   * Trả về số thứ tự cố định của lịch khám.
   */
  private estimatedQueueNumber(row: { queueNumber: number | null }) {
    return row.queueNumber;
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

  async checkout(accountId: string, dto: CheckoutAppointmentDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const profile = await tx.patientProfile.findFirst({
          where: { id: dto.patientProfileId, accountId },
        });
        if (!profile) throw new NotFoundException('Không tìm thấy hồ sơ bệnh nhân');

        if (dto.bookingType === 'DOCTOR') {
          if (!dto.scheduleSlotId) throw new BadRequestException('Thiếu khung giờ của bác sĩ');
          
          let doctorSlot: any = null;
          if (dto.scheduleSlotId.startsWith('virtual_')) {
            const parts = dto.scheduleSlotId.split('_');
            const scheduleId = parts[1];
            const startTimeStr = parts[2];
            const schedule = await tx.doctorSchedule.findUnique({ where: { id: scheduleId }, include: { doctor: true } });
            if (!schedule || schedule.status !== 'OPEN' || !schedule.doctor.isActive) throw new NotFoundException('Lịch làm việc của bác sĩ không khả dụng');

            const dateStr = schedule.workDate.toISOString().slice(0, 10);
            const startDt = new Date(`${dateStr}T${startTimeStr}:00.000Z`);
            const endDt = new Date(startDt.getTime() + (schedule.slotDurationMin || 30) * 60000);

            doctorSlot = await tx.doctorScheduleSlot.upsert({
              where: { scheduleId_startTime: { scheduleId, startTime: startDt } },
              update: {},
              create: { scheduleId, startTime: startDt, endTime: endDt, capacity: 1, occupiedCount: 0 },
              include: { schedule: { include: { doctor: true } } },
            });
          } else {
            doctorSlot = await tx.doctorScheduleSlot.findUnique({ where: { id: dto.scheduleSlotId }, include: { schedule: { include: { doctor: true } } } });
          }

          if (!doctorSlot || !doctorSlot.isActive || doctorSlot.schedule.status !== 'OPEN' || !doctorSlot.schedule.doctor.isActive) throw new NotFoundException('Khung giờ của bác sĩ không khả dụng');
          this.validateBookingLeadTime(doctorSlot.schedule.workDate);
          const duplicate = await tx.appointment.findFirst({ where: { patientProfileId: profile.id, scheduleSlotId: doctorSlot.id, status: { in: ACTIVE_APPOINTMENT_STATUSES } } });
          if (duplicate) throw new ConflictException('Người bệnh đã có lịch hẹn trong khung giờ này');
          const reserved = await tx.$executeRaw`UPDATE "doctor_schedule_slots" SET "occupied_count" = "occupied_count" + 1, "updated_at" = NOW() WHERE "id" = ${doctorSlot.id}::uuid AND "is_active" = TRUE AND "occupied_count" < "capacity"`;
          if (reserved !== 1) throw new ConflictException('Bác sĩ vừa hết chỗ trong khung giờ này');
          const holdTtlMs = this.config.getOrThrow<RabbitMqConfig>('rabbitmq').holdTtlMs;
          const [{ now, expiresAt }] = await tx.$queryRaw<Array<{ now: Date; expiresAt: Date }>>`SELECT NOW() AS "now", NOW() + (${holdTtlMs} * INTERVAL '1 millisecond') AS "expiresAt"`;
          const price = doctorSlot.schedule.doctor.consultationFee;
          const subtotal = Number(price);
          const serviceFee = BOOKING_SERVICE_FEE;
          let discountAmount = 0;
          let voucherApplied: any = null;
          if (dto.voucherCode) {
            const vResult = await this.vouchersService.validateVoucher(dto.voucherCode, subtotal, accountId);
            discountAmount = vResult.discountAmount;
            voucherApplied = vResult.voucher;
          }
          const totalAmount = Math.max(0, subtotal + serviceFee - discountAmount);

          const appointment = await tx.appointment.create({ data: { patientProfileId: profile.id, branchId: doctorSlot.schedule.branchId, scheduleSlotId: doctorSlot.id, servicePrice: price, symptomsDescription: dto.symptomsDescription, bookedViaAi: dto.bookedViaAi ?? false, holdExpiresAt: expiresAt, statusHistories: { create: { toStatus: 'PENDING_PAYMENT', actorId: accountId } } } });

          const invoiceItems = [
            { description: `Khám với ${doctorSlot.schedule.doctor.fullName}`, quantity: 1, unitPrice: price, amount: price },
            { description: 'Phí tiện ích dịch vụ', quantity: 1, unitPrice: new Prisma.Decimal(serviceFee), amount: new Prisma.Decimal(serviceFee) },
          ];
          if (discountAmount > 0 && voucherApplied) {
            invoiceItems.push({
              description: `Mã ưu đãi (${voucherApplied.code})`,
              quantity: 1,
              unitPrice: new Prisma.Decimal(-discountAmount),
              amount: new Prisma.Decimal(-discountAmount),
            });
          }

          const invoice = await tx.invoice.create({
            data: {
              appointmentId: appointment.id,
              issuedBranchId: doctorSlot.schedule.branchId,
              subtotal: price,
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

          const payment = await tx.paymentTransaction.create({ data: { invoiceId: invoice.id, provider: 'PENDING_SELECTION', idempotencyKey: `checkout:${appointment.id}`, method: 'ONLINE', amount: invoice.totalAmount } });
          await tx.outboxEvent.create({ data: { aggregateType: 'Appointment', aggregateId: appointment.id, eventType: 'appointment.hold.created', payload: { appointmentId: appointment.id, doctorSlotId: doctorSlot.id, holdExpiresAt: expiresAt.toISOString() } } });
          return { appointmentId: appointment.id, invoiceId: invoice.id, paymentId: payment.id, status: appointment.status, holdStartedAt: now, holdExpiresAt: expiresAt, subtotal, serviceFee, discountAmount, totalAmount };
        }

        if (!dto.servicePackageId) throw new BadRequestException('Thiếu gói dịch vụ');
        const slotId = dto.scheduleSlotId || dto.servicePackageScheduleSlotId;
        if (!slotId) throw new BadRequestException('Thiếu khung giờ khám');

        const servicePackage = await tx.servicePackage.findUnique({
          where: { id: dto.servicePackageId },
          include: { branchBookingMethod: true },
        });
        if (!servicePackage || !servicePackage.isActive || !servicePackage.branchBookingMethod.isEnabled) {
          throw new NotFoundException('Gói dịch vụ không khả dụng');
        }

        const doctorSlot = await tx.doctorScheduleSlot.findUnique({
          where: { id: slotId },
          include: { schedule: { include: { doctor: true, room: true } } },
        });
        if (!doctorSlot || !doctorSlot.isActive || doctorSlot.schedule.status !== 'OPEN') {
          throw new NotFoundException('Khung giờ của bác sĩ không khả dụng');
        }
        this.validateBookingLeadTime(doctorSlot.schedule.workDate);

        if (doctorSlot.schedule.branchId !== servicePackage.branchBookingMethod.branchId) {
          throw new ConflictException('Khung giờ khám không thuộc cơ sở của gói dịch vụ');
        }
        if (servicePackage.specialtyId) {
          const compatible = await tx.doctorSpecialty.count({
            where: { doctorId: doctorSlot.schedule.doctorId, specialtyId: servicePackage.specialtyId },
          });
          if (!compatible) throw new BadRequestException('Bác sĩ không thuộc chuyên khoa của gói dịch vụ');
        }

        const duplicate = await tx.appointment.findFirst({
          where: { patientProfileId: profile.id, scheduleSlotId: doctorSlot.id, status: { in: ACTIVE_APPOINTMENT_STATUSES } },
        });
        if (duplicate) throw new ConflictException('Người bệnh đã có lịch hẹn trong khung giờ này');

        const reserved = await tx.$executeRaw`UPDATE "doctor_schedule_slots" SET "occupied_count" = "occupied_count" + 1, "updated_at" = NOW() WHERE "id" = ${doctorSlot.id}::uuid AND "is_active" = TRUE AND "occupied_count" < "capacity"`;
        if (reserved !== 1) throw new ConflictException('Khung giờ vừa hết chỗ');

        const holdTtlMs = this.config.getOrThrow<RabbitMqConfig>('rabbitmq').holdTtlMs;
        const [{ now, expiresAt }] = await tx.$queryRaw<Array<{ now: Date; expiresAt: Date }>>`
          SELECT
            NOW() AS "now",
            NOW() + (${holdTtlMs} * INTERVAL '1 millisecond') AS "expiresAt"
        `;

        const subtotal = Number(servicePackage.price);
        const serviceFee = BOOKING_SERVICE_FEE;
        let discountAmount = 0;
        let voucherApplied: any = null;
        if (dto.voucherCode) {
          const vResult = await this.vouchersService.validateVoucher(dto.voucherCode, subtotal, accountId);
          discountAmount = vResult.discountAmount;
          voucherApplied = vResult.voucher;
        }
        const totalAmount = Math.max(0, subtotal + serviceFee - discountAmount);

        const appointment = await tx.appointment.create({
          data: {
            patientProfileId: profile.id,
            branchId: servicePackage.branchBookingMethod.branchId,
            scheduleSlotId: doctorSlot.id,
            servicePackageId: servicePackage.id,
            servicePrice: servicePackage.price,
            symptomsDescription: dto.symptomsDescription,
            bookedViaAi: dto.bookedViaAi ?? false,
            holdExpiresAt: expiresAt,
            statusHistories: { create: { toStatus: 'PENDING_PAYMENT', actorId: accountId } },
          },
        });

        const invoiceItems = [
          { description: servicePackage.name, quantity: 1, unitPrice: servicePackage.price, amount: servicePackage.price },
          { description: 'Phí tiện ích dịch vụ', quantity: 1, unitPrice: new Prisma.Decimal(serviceFee), amount: new Prisma.Decimal(serviceFee) },
        ];
        if (discountAmount > 0 && voucherApplied) {
          invoiceItems.push({
            description: `Mã ưu đãi (${voucherApplied.code})`,
            quantity: 1,
            unitPrice: new Prisma.Decimal(-discountAmount),
            amount: new Prisma.Decimal(-discountAmount),
          });
        }

        const invoice = await tx.invoice.create({
          data: {
            appointmentId: appointment.id,
            issuedBranchId: servicePackage.branchBookingMethod.branchId,
            subtotal: servicePackage.price,
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
            invoiceId: invoice.id,
            provider: 'PENDING_SELECTION',
            idempotencyKey: `checkout:${appointment.id}`,
            method: 'ONLINE',
            amount: invoice.totalAmount,
          },
        });
        await tx.outboxEvent.create({
          data: {
            aggregateType: 'Appointment', aggregateId: appointment.id,
            eventType: 'appointment.hold.created',
            payload: { appointmentId: appointment.id, doctorSlotId: doctorSlot.id, holdExpiresAt: expiresAt.toISOString() },
          },
        });
        return { appointmentId: appointment.id, invoiceId: invoice.id, paymentId: payment.id, status: appointment.status, holdStartedAt: now, holdExpiresAt: expiresAt, subtotal, serviceFee, discountAmount, totalAmount };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
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

  async expireHold(appointmentId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.findUnique({ where: { id: appointmentId } });
      if (!appointment) return false;
      const changed = await tx.appointment.updateMany({
        where: { id: appointmentId, status: 'PENDING_PAYMENT', holdExpiresAt: { lte: new Date() } },
        data: { status: 'EXPIRED' },
      });
      if (changed.count !== 1) return false;
      if (appointment.scheduleSlotId) {
        await tx.$executeRaw`
          UPDATE "doctor_schedule_slots"
          SET "occupied_count" = GREATEST("occupied_count" - 1, 0), "updated_at" = NOW()
          WHERE "id" = ${appointment.scheduleSlotId}::uuid
        `;
      }
      await tx.paymentTransaction.updateMany({ where: { invoice: { appointmentId }, status: 'PENDING' }, data: { status: 'EXPIRED' } });
      await tx.appointmentStatusHistory.create({ data: { appointmentId, fromStatus: 'PENDING_PAYMENT', toStatus: 'EXPIRED', reason: 'PAYMENT_HOLD_TIMEOUT' } });
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async handlePaymentWebhook(provider: string, dto: PaymentWebhookDto) {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.paymentTransaction.findUnique({
        where: { id: dto.paymentId },
        include: {
          invoice: {
            include: {
              appointment: true,
              bookingOrder: {
                include: {
                  appointments: {
                    include: {
                      scheduleSlot: true,
                    },
                  },
                },
              },
            },
          },
        },
      });
      if (!payment) throw new NotFoundException('Không tìm thấy giao dịch');
      if (payment.providerTransactionId === dto.providerTransactionId && ['SUCCESS', 'LATE_SUCCESS', 'REFUND_REQUIRED', 'MANUAL_REVIEW'].includes(payment.status)) {
        return {
          status: payment.status,
          appointmentStatus: payment.invoice.appointment?.status ?? (payment.invoice.bookingOrder?.status as any),
        };
      }
      if (dto.status === 'FAILED') {
        await tx.paymentTransaction.update({
          where: { id: payment.id },
          data: { provider, providerTransactionId: dto.providerTransactionId, status: 'FAILED', rawPayload: dto.payload as Prisma.InputJsonValue },
        });
        if (payment.invoice.bookingOrder) {
          await (tx as any).bookingOrder.update({
            where: { id: payment.invoice.bookingOrder.id },
            data: { status: 'CANCELLED' },
          });
        }
        return {
          status: PaymentStatus.FAILED,
          appointmentStatus: payment.invoice.appointment?.status ?? 'CANCELLED',
        };
      }

      // Xử lý đơn tổng BookingOrder (Batch Payment)
      const bookingOrder = payment.invoice.bookingOrder;
      if (bookingOrder) {
        return this.confirmPaidBatch(tx, payment.id, payment.invoiceId, bookingOrder.id, bookingOrder.appointments, provider, dto);
      }

      const appointment = payment.invoice.appointment;
      if (appointment) {
        if (appointment.status === 'PENDING_PAYMENT' && appointment.holdExpiresAt && appointment.holdExpiresAt > new Date()) {
          return this.confirmPaid(tx, payment.id, payment.invoiceId, appointment.id, provider, dto, false);
        }
        if (appointment.status === 'EXPIRED') {
          const doctorReserved = appointment.scheduleSlotId ? await tx.$executeRaw`UPDATE "doctor_schedule_slots" SET "occupied_count" = "occupied_count" + 1, "updated_at" = NOW() WHERE "id" = ${appointment.scheduleSlotId}::uuid AND "occupied_count" < "capacity" AND "is_active" = TRUE` : 0;
          if (doctorReserved === 1) return this.confirmPaid(tx, payment.id, payment.invoiceId, appointment.id, provider, dto, true);
          await tx.paymentTransaction.update({ where: { id: payment.id }, data: { provider, providerTransactionId: dto.providerTransactionId, status: 'REFUND_REQUIRED', paidAt: new Date(), rawPayload: dto.payload as Prisma.InputJsonValue } });
          await tx.appointment.update({ where: { id: appointment.id }, data: { status: 'REFUND_REQUIRED', statusHistories: { create: { fromStatus: 'EXPIRED', toStatus: 'REFUND_REQUIRED', reason: 'LATE_SUCCESS_SLOT_FULL' } } } });
          await tx.outboxEvent.create({ data: { aggregateType: 'PaymentTransaction', aggregateId: payment.id, eventType: 'payment.refund.required', payload: { paymentId: payment.id, appointmentId: appointment.id, reason: 'LATE_SUCCESS_SLOT_FULL' } } });
          return { status: PaymentStatus.REFUND_REQUIRED, appointmentStatus: AppointmentStatus.REFUND_REQUIRED };
        }
        return { status: payment.status, appointmentStatus: appointment.status };
      }
      return { status: payment.status, appointmentStatus: 'UNKNOWN' };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async paymentStatus(appointmentIdOrOrderId: string, accountId: string) {
    const row = await this.prisma.appointment.findFirst({
      where: {
        id: appointmentIdOrOrderId,
        OR: [
          { patientProfile: { accountId } },
          { bookingOrder: { accountId } },
        ],
      },
      select: {
        id: true,
        bookingOrderId: true,
        status: true,
        holdExpiresAt: true,
        bookingCode: true,
        queueNumber: true,
        invoice: { select: { payments: { select: { status: true }, orderBy: { createdAt: 'desc' }, take: 1 } } },
        qrToken: { select: { id: true } },
        branch: { select: { id: true, name: true, address: true } },
        scheduleSlot: {
          select: {
            schedule: {
              select: {
                room: { select: { id: true, code: true, name: true } },
                branch: { select: { id: true, name: true, address: true } },
              },
            },
          },
        },
      },
    });

    if (!row) {
      // Thử tìm theo bookingOrderId
      const order = await (this.prisma as any).bookingOrder.findFirst({
        where: { id: appointmentIdOrOrderId, accountId },
        select: {
          id: true,
          orderCode: true,
          groupType: true,
          status: true,
          totalAmount: true,
          invoice: { select: { payments: { select: { status: true }, orderBy: { createdAt: 'desc' }, take: 1 } } },
          appointments: {
            select: {
              id: true,
              bookingCode: true,
              status: true,
              queueNumber: true,
              patientProfile: { select: { id: true, fullName: true } },
              qrToken: { select: { id: true } },
            },
          },
        },
      });
      if (!order) throw new NotFoundException('Không tìm thấy lịch hẹn hoặc đơn đặt lịch');
      const firstAppt = order.appointments[0];
      return {
        bookingOrderId: order.id,
        appointmentId: firstAppt?.id || order.id,
        orderCode: order.orderCode,
        groupType: order.groupType,
        status: order.status,
        paymentStatus: order.invoice?.payments[0]?.status ?? null,
        totalAmount: Number(order.totalAmount),
        appointments: order.appointments.map((a: any) => ({
          appointmentId: a.id,
          bookingCode: a.bookingCode,
          status: a.status,
          queueNumber: a.queueNumber,
          patient: { id: a.patientProfile?.id, fullName: a.patientProfile?.fullName },
          hasQr: Boolean(a.qrToken),
        })),
      };
    }

    const doctorSlot = row.scheduleSlot;
    const room = doctorSlot?.schedule.room;
    const branch = doctorSlot?.schedule.branch ?? row.branch;
    const estimatedQueueNumber = this.estimatedQueueNumber(row);

    let siblingAppts: any[] = [];
    if (row.bookingOrderId) {
      const siblings = await (this.prisma as any).appointment.findMany({
        where: { bookingOrderId: row.bookingOrderId },
        select: {
          id: true,
          bookingCode: true,
          status: true,
          queueNumber: true,
          patientProfile: { select: { id: true, fullName: true } },
          qrToken: { select: { id: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
      siblingAppts = siblings.map((a: any) => ({
        appointmentId: a.id,
        bookingCode: a.bookingCode,
        status: a.status,
        queueNumber: a.queueNumber,
        patient: { id: a.patientProfile?.id, fullName: a.patientProfile?.fullName },
        hasQr: Boolean(a.qrToken),
      }));
    }

    return {
      appointmentId: row.id,
      bookingOrderId: row.bookingOrderId,
      status: row.status,
      holdExpiresAt: row.holdExpiresAt,
      paymentStatus: row.invoice?.payments[0]?.status ?? null,
      hasQr: Boolean(row.qrToken),
      bookingCode: row.bookingCode,
      queueNumber: row.queueNumber,
      estimatedQueueNumber: row.queueNumber ?? estimatedQueueNumber,
      room: room ? { id: room.id, code: room.code, name: room.name } : null,
      branch: branch ? { id: branch.id, name: branch.name, address: branch.address } : null,
      appointments: siblingAppts.length > 0 ? siblingAppts : undefined,
    };
  }

  async myAppointments(accountId: string) {
    const rows = await this.prisma.appointment.findMany({
      where: {
        OR: [
          { patientProfile: { accountId } },
          { bookingOrder: { accountId } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        bookingCode: true,
        bookingOrderId: true,
        status: true,
        queueNumber: true,
        holdExpiresAt: true,
        rescheduleCount: true,
        createdAt: true,
        servicePrice: true,
        servicePackageId: true,
        scheduleSlotId: true,
        branchId: true,
        patientProfile: {
          select: { id: true, fullName: true },
        },
        servicePackage: {
          select: { id: true, name: true },
        },
        branch: {
          select: { id: true, name: true, address: true },
        },
        bookingOrder: {
          select: { orderCode: true, groupType: true },
        },
        invoice: {
          select: {
            totalAmount: true,
            status: true,
            payments: {
              select: { status: true },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
        scheduleSlot: {
          select: {
            startTime: true,
            endTime: true,
            schedule: {
              select: {
                workDate: true,
                doctorId: true,
                doctor: {
                  select: {
                    id: true,
                    user: { select: { fullName: true } },
                  },
                },
                room: {
                  select: { id: true, code: true, name: true },
                },
                branch: {
                  select: { id: true, name: true, address: true },
                },
              },
            },
          },
        },
      },
    });
    return rows.map((row) => {
      const doctorSlot = row.scheduleSlot;
      const room = doctorSlot?.schedule.room;
      const branch = doctorSlot?.schedule.branch ?? row.branch;
      return {
        id: row.id,
        bookingCode: row.bookingCode,
        bookingOrderId: row.bookingOrderId,
        orderCode: (row as any).bookingOrder?.orderCode ?? null,
        groupType: (row as any).bookingOrder?.groupType ?? null,
        status: row.status,
        queueNumber: row.queueNumber,
        holdExpiresAt: row.holdExpiresAt,
        rescheduleCount: (row as any).rescheduleCount ?? 0,
        createdAt: row.createdAt,
        appointmentDate: doctorSlot?.schedule.workDate?.toISOString().slice(0, 10) ?? null,
        startTime: doctorSlot?.startTime?.toISOString().slice(11, 16) ?? null,
        endTime: doctorSlot?.endTime?.toISOString().slice(11, 16) ?? null,
        scheduleSlotId: row.scheduleSlotId,
        servicePackageId: row.servicePackageId,
        patient: { id: row.patientProfile.id, fullName: row.patientProfile.fullName },
        doctor: (() => { const d = doctorSlot?.schedule?.doctor; return d ? { id: d.id, fullName: d.user?.fullName ?? '' } : null; })(),
        doctorId: doctorSlot?.schedule?.doctorId ?? null,
        service: row.servicePackage ? { id: row.servicePackage.id, name: row.servicePackage.name } : null,
        healthPackage: row.servicePackage ? { id: row.servicePackage.id, name: row.servicePackage.name } : null,
        branch: branch ? { id: branch.id, name: branch.name, address: branch.address } : null,
        branchId: branch?.id ?? row.branchId,
        room: room ? { id: room.id, code: room.code, name: room.name } : null,
        totalAmount: Number(row.invoice?.totalAmount ?? row.servicePrice ?? 0),
        invoiceStatus: row.invoice?.status ?? null,
        paymentStatus: row.invoice?.payments[0]?.status ?? null,
      };
    });
  }

  async issueCheckInPass(appointmentId: string, accountId: string) {
    const row = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, patientProfile: { accountId } },
      select: {
        id: true,
        bookingCode: true,
        status: true,
        queueNumber: true,
        servicePrice: true,
        patientProfile: {
          select: {
            id: true,
            fullName: true,
            gender: true,
            dateOfBirth: true,
            nationalId: true,
            phoneNumber: true,
          },
        },
        servicePackage: {
          select: { id: true, name: true },
        },
        branch: {
          select: { id: true, name: true, address: true },
        },
        invoice: {
          select: {
            totalAmount: true,
            status: true,
            payments: {
              select: { status: true },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
        scheduleSlot: {
          select: {
            startTime: true,
            endTime: true,
            schedule: {
              select: {
                workDate: true,
                room: { select: { id: true, code: true, name: true } },
                branch: { select: { id: true, name: true, address: true } },
                doctor: {
                  select: {
                    id: true,
                    academicRank: true,
                    user: { select: { fullName: true } },
                    specialties: {
                      select: {
                        specialty: { select: { name: true } },
                      },
                      take: 1,
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Không tìm thấy lịch hẹn');
    if (!['BOOKED', 'CHECKED_IN'].includes(row.status)) throw new ConflictException('Lịch hẹn chưa sẵn sàng check-in');
    const doctorSlot = row.scheduleSlot;
    const room = doctorSlot?.schedule.room;
    const branch = doctorSlot?.schedule.branch ?? row.branch;
    if (!branch) throw new ConflictException('Không xác định được cơ sở khám');

    const rawToken = this.checkInToken(row.id);
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const appointmentDate = (doctorSlot?.schedule.workDate ? doctorSlot.schedule.workDate.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
    const expiresAt = new Date(`${appointmentDate}T23:59:59.999+07:00`);
    await this.prisma.appointmentQrToken.upsert({
      where: { appointmentId: row.id },
      update: { tokenHash, expiresAt, usedAt: row.status === 'CHECKED_IN' ? new Date() : null },
      create: { appointmentId: row.id, tokenHash, expiresAt },
    });
    const estimatedQueueNumber = this.estimatedQueueNumber(row);
    const doc = doctorSlot?.schedule?.doctor;
    const specialtyName = doc?.specialties?.[0]?.specialty?.name || (row.servicePackage ? 'Đa khoa / Gói khám' : 'Khám chuyên khoa');

    return {
      appointmentId: row.id,
      bookingCode: row.bookingCode,
      qrPayload: `VITACARE_CHECKIN:${rawToken}`,
      expiresAt,
      status: row.status,
      queueNumber: row.queueNumber,
      estimatedQueueNumber,
      appointmentDate,
      startTime: doctorSlot?.startTime ? doctorSlot.startTime.toISOString().slice(11, 16) : null,
      endTime: doctorSlot?.endTime ? doctorSlot.endTime.toISOString().slice(11, 16) : null,
      room: room ? { id: room.id, code: room.code, name: room.name } : null,
      branch: { id: branch.id, name: branch.name, address: branch.address },
      doctor: doc ? { id: doc.id, fullName: doc.user?.fullName ?? '', academicRank: doc.academicRank ?? null } : null,
      specialty: specialtyName,
      healthPackage: row.servicePackage ? { id: row.servicePackage.id, name: row.servicePackage.name } : null,
      patient: {
        id: row.patientProfile.id,
        fullName: row.patientProfile.fullName,
        gender: row.patientProfile.gender,
        dateOfBirth: row.patientProfile.dateOfBirth ? row.patientProfile.dateOfBirth.toISOString().slice(0, 10) : null,
        nationalId: row.patientProfile.nationalId || null,
        phoneNumber: row.patientProfile.phoneNumber || null,
      },
      totalAmount: Number(row.invoice?.totalAmount ?? row.servicePrice ?? 0),
      paymentStatus: row.invoice?.payments[0]?.status ?? (['BOOKED', 'CHECKED_IN'].includes(row.status) ? 'PAID' : null),
    };
  }

  /**
   * Bệnh nhân tự hủy lịch hẹn đã đặt.
   * Xử lý giải phóng slot, hoàn tiền (REFUND_REQUIRED), ghi nhận lịch sử và gửi email.
   */
  async cancelMyAppointment(accountId: string, appointmentId: string, reason?: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        bookingOrder: true,
        patientProfile: { include: { account: { select: { email: true } } } },
        scheduleSlot: { include: { schedule: { include: { doctor: { include: { user: true } }, branch: true } } } },
        servicePackage: true,
        branch: true,
        invoice: { include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } } },
      },
    });

    if (!appointment) throw new NotFoundException('Không tìm thấy lịch hẹn');

    // Kiểm tra quyền sở hữu lịch hẹn
    const isOwner = appointment.bookingOrder?.accountId === accountId || appointment.patientProfile?.accountId === accountId;
    if (!isOwner) throw new ForbiddenException('Bạn không có quyền hủy lịch hẹn này');

    // Chỉ cho phép hủy khi đang ở trạng thái BOOKED hoặc PENDING_PAYMENT
    if (!['BOOKED', 'PENDING_PAYMENT'].includes(appointment.status)) {
      throw new BadRequestException(`Không thể hủy lịch hẹn đang ở trạng thái «${appointment.status}»`);
    }

    // Tính toán thời gian khám để kiểm tra tính cấp bách (sát giờ < 24h hoặc sau 16h30 ngày trước)
    const doctorSlot = appointment.scheduleSlot;
    const examDate = doctorSlot?.schedule?.workDate;
    const startTimeDate = doctorSlot?.startTime;

    const now = new Date();
    let isUrgent = false;

    if (examDate && startTimeDate) {
      const examDateStr = examDate.toISOString().slice(0, 10);
      const startTimeStr = startTimeDate.toISOString().slice(11, 16);
      const appointmentDateTime = new Date(`${examDateStr}T${startTimeStr}:00+07:00`);

      const hoursUntilExam = (appointmentDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);

      // Nếu dưới 24h -> Coi là hủy gấp
      if (hoursUntilExam < 24) {
        isUrgent = true;
      }
    }

    const previousStatus = appointment.status;
    const latestPayment = appointment.invoice?.payments?.[0];
    const isPaid = latestPayment?.status === 'SUCCESS';

    await this.prisma.$transaction(async (tx) => {
      // 1. Cập nhật trạng thái Appointment -> CANCELLED
      await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          status: 'CANCELLED',
        },
      });

      // 2. Trả lại slot occupiedCount (giải phóng slot ngay lập tức)
      if (appointment.scheduleSlotId) {
        await tx.$executeRaw`
          UPDATE "doctor_schedule_slots"
          SET "occupied_count" = GREATEST("occupied_count" - 1, 0), "updated_at" = NOW()
          WHERE "id" = ${appointment.scheduleSlotId}::uuid
        `;
      }

      // 3. Nếu đã thanh toán trực tuyến thành công -> Tạo yêu cầu hoàn tiền
      if (isPaid && latestPayment) {
        await tx.paymentTransaction.update({
          where: { id: latestPayment.id },
          data: {
            status: 'REFUND_REQUIRED',
          },
        });

        if (appointment.invoice) {
          await tx.invoice.update({
            where: { id: appointment.invoice.id },
            data: { status: 'REFUNDED' },
          });
        }

        // Bắn Outbox event thông báo hoàn tiền
        await tx.outboxEvent.create({
          data: {
            aggregateType: 'PaymentTransaction',
            aggregateId: latestPayment.id,
            eventType: 'payment.refund.required',
            payload: {
              paymentId: latestPayment.id,
              appointmentId: appointment.id,
              bookingCode: appointment.bookingCode,
              amount: Number(latestPayment.amount),
              isUrgent,
              reason: reason || 'Bệnh nhân tự hủy lịch khám',
            },
          },
        });
      }

      // 4. Ghi nhận lịch sử trạng thái
      await tx.appointmentStatusHistory.create({
        data: {
          appointmentId: appointment.id,
          fromStatus: previousStatus,
          toStatus: 'CANCELLED',
          actorId: accountId,
          reason: reason ? `Bệnh nhân hủy: ${reason}${isUrgent ? ' (HỦY GẤP)' : ''}` : `Bệnh nhân tự hủy lịch${isUrgent ? ' (HỦY GẤP)' : ''}`,
        },
      });
    });

    // 5. Gửi email xác nhận hủy lịch cho bệnh nhân
    const patientEmail = appointment.patientProfile?.account?.email;
    if (patientEmail) {
      const examDateStr = doctorSlot?.schedule?.workDate?.toISOString().slice(0, 10) ?? '';
      const startTimeStr = doctorSlot?.startTime?.toISOString().slice(11, 16) ?? '';
      const doctorName = doctorSlot?.schedule?.doctor
        ? `${doctorSlot.schedule.doctor.academicRank ? doctorSlot.schedule.doctor.academicRank + ' ' : ''}${doctorSlot.schedule.doctor.user?.fullName ?? ''}`.trim()
        : null;
      const serviceName = appointment.servicePackage?.name || null;
      const branchName = doctorSlot?.schedule?.branch?.name || appointment.branch?.name || 'VitaCare Clinic';

      try {
        await this.mailsService.sendAppointmentCancellation({
          to: patientEmail,
          data: {
            patientName: appointment.patientProfile.fullName,
            bookingCode: appointment.bookingCode || appointment.id,
            appointmentDate: examDateStr,
            startTime: startTimeStr,
            branchName,
            doctorOrServiceName: doctorName ? `Bác sĩ ${doctorName}` : (serviceName || 'Khám chuyên khoa'),
            cancelReason: reason || 'Bệnh nhân có việc bận cá nhân',
            cancelledBy: 'PATIENT',
            refundStatusNote: isPaid
              ? (isUrgent
                ? 'Lịch hẹn được hủy sát giờ khám (<24h). Yêu cầu hoàn tiền đã được gửi tới Ban quản lý cơ sở để xét duyệt theo chính sách phòng khám.'
                : 'Yêu cầu hoàn tiền 100% đã được ghi nhận. Số tiền sẽ được hoàn về tài khoản MoMo / Ngân hàng của quý khách trong 1-3 ngày làm việc.')
              : undefined,
          },
        });
      } catch {
        // Không block response nếu email lỗi
      }
    }

    return {
      success: true,
      isUrgent,
      message: isUrgent
        ? 'Hủy lịch khám thành công. Do bạn hủy sát giờ khám (< 24 giờ), yêu cầu hoàn tiền sẽ được chuyển tới Quản lý phòng khám để xét duyệt theo chính sách.'
        : 'Hủy lịch khám thành công. Slot khám đã được giải phóng và yêu cầu hoàn tiền 100% đã được ghi nhận.',
    };
  }

  /**
   * Đổi lịch khám sang khung giờ mới (Reschedule)
   * Nghiệp vụ chuẩn y tế:
   * - Chỉ áp dụng cho lịch đã xác nhận (BOOKED)
   * - Phải trước giờ khám ít nhất 6 giờ (hoặc trong vòng 30 phút sau khi vừa đặt)
   * - Tối đa 2 lần đổi lịch
   * - Khóa và chuyển slot nguyên tử (Atomic Transfer)
   * - Cập nhật queueNumber, gửi email thông báo
   */
  async rescheduleMyAppointment(accountId: string, appointmentId: string, dto: RescheduleAppointmentDto) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        bookingOrder: true,
        patientProfile: { include: { account: { select: { email: true } } } },
        scheduleSlot: { include: { schedule: { include: { doctor: { include: { user: true } }, branch: true, room: true } } } },
        servicePackage: true,
        branch: true,
      },
    });

    if (!appointment) throw new NotFoundException('Không tìm thấy lịch hẹn');

    // 1. Kiểm tra quyền sở hữu lịch hẹn
    const isOwner = appointment.bookingOrder?.accountId === accountId || appointment.patientProfile?.accountId === accountId;
    if (!isOwner) throw new ForbiddenException('Bạn không có quyền đổi lịch hẹn này');

    // 2. Chỉ cho phép đổi khi đang ở trạng thái BOOKED
    if (appointment.status !== 'BOOKED') {
      throw new BadRequestException(`Không thể đổi lịch hẹn đang ở trạng thái «${appointment.status}». Chỉ áp dụng cho lịch đã xác nhận.`);
    }

    // 3. Kiểm tra số lần đổi lịch (tối đa 2 lần)
    if (appointment.rescheduleCount >= 2) {
      throw new BadRequestException('Lịch hẹn này đã đạt giới hạn tối đa 2 lần đổi lịch.');
    }

    // 4. Kiểm tra thời gian tối thiểu 6 giờ (hoặc ân hạn 30 phút sau khi đặt)
    const oldSlot = appointment.scheduleSlot;
    const oldWorkDate = oldSlot?.schedule?.workDate;
    const oldStartTime = oldSlot?.startTime;

    const now = new Date();
    const createdRecently = (now.getTime() - appointment.createdAt.getTime()) <= 30 * 60 * 1000; // Trong vòng 30 phút sau khi đặt

    if (!createdRecently && oldWorkDate && oldStartTime) {
      const dateStr = oldWorkDate.toISOString().slice(0, 10);
      const timeStr = oldStartTime.toISOString().slice(11, 16);
      const apptDateTime = new Date(`${dateStr}T${timeStr}:00+07:00`);
      const hoursUntilExam = (apptDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);

      if (hoursUntilExam < 6) {
        throw new BadRequestException('Chỉ được đổi lịch trước giờ khám ít nhất 6 giờ. Lịch khám của bạn đã quá sát giờ, vui lòng liên hệ hotline phòng khám để được hỗ trợ.');
      }
    }

    // 5. Xác thực slot mới
    let newSlot: any = null;
    if (dto.newScheduleSlotId.startsWith('virtual_')) {
      const parts = dto.newScheduleSlotId.split('_');
      const scheduleId = parts[1];
      const startTimeStr = parts[2];
      const schedule = await this.prisma.doctorSchedule.findUnique({ where: { id: scheduleId }, include: { doctor: true } });
      if (!schedule || schedule.status !== 'OPEN' || !schedule.doctor.isActive) throw new NotFoundException('Lịch làm việc mới không khả dụng');

      const dateStr = schedule.workDate.toISOString().slice(0, 10);
      const startDt = new Date(`${dateStr}T${startTimeStr}:00.000Z`);
      const endDt = new Date(startDt.getTime() + (schedule.slotDurationMin || 30) * 60000);

      newSlot = await this.prisma.doctorScheduleSlot.upsert({
        where: { scheduleId_startTime: { scheduleId, startTime: startDt } },
        update: {},
        create: { scheduleId, startTime: startDt, endTime: endDt, capacity: 1, occupiedCount: 0 },
        include: { schedule: { include: { doctor: { include: { user: true } }, branch: true, room: true } } },
      });
    } else {
      newSlot = await this.prisma.doctorScheduleSlot.findUnique({
        where: { id: dto.newScheduleSlotId },
        include: { schedule: { include: { doctor: { include: { user: true } }, branch: true, room: true } } },
      });
    }

    if (!newSlot || !newSlot.isActive || newSlot.schedule.status !== 'OPEN') {
      throw new NotFoundException('Khung giờ khám mới không khả dụng');
    }

    if (newSlot.id === appointment.scheduleSlotId) {
      throw new BadRequestException('Khung giờ mới trùng với khung giờ hiện tại');
    }

    // Kiểm tra phạm vi đổi lịch:
    // Nếu là khám bác sĩ -> phải cùng bác sĩ
    if (!appointment.servicePackageId && oldSlot?.schedule?.doctorId) {
      if (newSlot.schedule.doctorId !== oldSlot.schedule.doctorId) {
        throw new BadRequestException('Khung giờ mới phải thuộc cùng Bác sĩ phụ trách');
      }
    }
    // Nếu là gói khám -> phải cùng chi nhánh
    if (appointment.servicePackageId && appointment.branchId) {
      if (newSlot.schedule.branchId !== appointment.branchId) {
        throw new BadRequestException('Khung giờ mới phải thuộc cùng cơ sở khám của gói dịch vụ');
      }
    }

    // Kiểm tra ngày khám mới phải trong tương lai
    const newWorkDate = newSlot.schedule.workDate;
    const newStartTime = newSlot.startTime;
    const newDateStr = newWorkDate.toISOString().slice(0, 10);
    const newTimeStr = newStartTime.toISOString().slice(11, 16);
    const newApptDateTime = new Date(`${newDateStr}T${newTimeStr}:00+07:00`);
    if (newApptDateTime.getTime() <= now.getTime()) {
      throw new BadRequestException('Không thể đổi sang khung giờ trong quá khứ');
    }

    // 6. Thực thi chuyển đổi nguyên tử (Atomic Transfer Transaction)
    const result = await this.prisma.$transaction(async (tx) => {
      // 6a. Khóa và tăng slot mới
      const reservedNew = await tx.$executeRaw`
        UPDATE "doctor_schedule_slots"
        SET "occupied_count" = "occupied_count" + 1, "updated_at" = NOW()
        WHERE "id" = ${newSlot.id}::uuid AND "is_active" = TRUE AND "occupied_count" < "capacity"
      `;
      if (reservedNew !== 1) {
        throw new ConflictException('Khung giờ mới vừa hết chỗ, vui lòng chọn khung giờ khác');
      }

      // 6b. Nhả slot cũ
      if (appointment.scheduleSlotId) {
        await tx.$executeRaw`
          UPDATE "doctor_schedule_slots"
          SET "occupied_count" = GREATEST("occupied_count" - 1, 0), "updated_at" = NOW()
          WHERE "id" = ${appointment.scheduleSlotId}::uuid
        `;
      }

      // 6c. Tính lại số thứ tự khám cho slot/ngày mới
      const newQueueNumber = await this.computeQueueNumber(tx, appointmentId, newSlot.id);

      // 6d. Cập nhật lịch hẹn
      const updated = await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          scheduleSlotId: newSlot.id,
          queueNumber: newQueueNumber,
          rescheduleCount: { increment: 1 },
          updatedAt: new Date(),
          statusHistories: {
            create: {
              fromStatus: 'BOOKED',
              toStatus: 'BOOKED',
              actorId: accountId,
              reason: `RESCHEDULED: Đổi từ slot [${oldSlot?.startTime?.toISOString().slice(11, 16)} ${oldWorkDate?.toISOString().slice(0, 10)}] sang [${newTimeStr} ${newDateStr}]. Lý do: ${dto.reason?.trim() || 'Người bệnh yêu cầu đổi lịch'}`,
            },
          },
        },
      });

      // 6e. Tạo sự kiện Outbox thông báo
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'Appointment',
          aggregateId: appointmentId,
          eventType: 'appointment.rescheduled',
          payload: {
            appointmentId,
            oldSlotId: oldSlot?.id,
            newSlotId: newSlot.id,
            newAppointmentDate: newDateStr,
            newStartTime: newTimeStr,
            newEndTime: newSlot.endTime.toISOString().slice(11, 16),
            queueNumber: newQueueNumber,
            reason: dto.reason?.trim(),
          },
        },
      });

      return {
        success: true,
        message: 'Đổi lịch khám thành công',
        appointmentId: updated.id,
        bookingCode: updated.bookingCode,
        newDate: newDateStr,
        newTime: `${newTimeStr} - ${newSlot.endTime.toISOString().slice(11, 16)}`,
        newQueueNumber,
        rescheduleCount: updated.rescheduleCount,
      };
    });

    // 7. Gửi email thông báo đổi lịch cho bệnh nhân
    const patientEmail = appointment.patientProfile?.account?.email;
    if (patientEmail) {
      const docName = newSlot.schedule?.doctor
        ? `${newSlot.schedule.doctor.academicRank ? newSlot.schedule.doctor.academicRank + ' ' : ''}${newSlot.schedule.doctor.user?.fullName ?? ''}`.trim()
        : null;
      const serviceName = appointment.servicePackage?.name || null;
      const branchName = newSlot.schedule?.branch?.name || appointment.branch?.name || 'VitaCare Clinic';
      const branchAddress = newSlot.schedule?.branch?.address || appointment.branch?.address || '';
      const roomName = newSlot.schedule?.room?.name ? `${newSlot.schedule.room.code} · ${newSlot.schedule.room.name}` : null;

      try {
        await this.mailsService.sendAppointmentRescheduled({
          to: patientEmail,
          data: {
            patientName: appointment.patientProfile.fullName,
            bookingCode: appointment.bookingCode || appointment.id,
            newAppointmentDate: result.newDate,
            newStartTime: newTimeStr,
            newEndTime: newSlot.endTime.toISOString().slice(11, 16),
            branchName,
            branchAddress,
            doctorOrServiceName: docName ? `Bác sĩ ${docName}` : (serviceName || 'Khám chuyên khoa'),
            roomName,
            queueNumber: result.newQueueNumber,
            reason: dto.reason?.trim() || null,
          },
        });
      } catch {
        // Không block response nếu email gửi lỗi
      }
    }

    return result;
  }

  async previewCheckIn(rawPayload: string, branchId?: string) {
    const rawToken = String(rawPayload || '').trim().replace(/^VITACARE_CHECKIN:/, '');
    if (!rawToken) throw new BadRequestException('Thiếu mã QR check-in');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    const qr = await this.prisma.appointmentQrToken.findUnique({
      where: { tokenHash },
      include: {
        appointment: {
          include: {
            patientProfile: true,
            servicePackage: true,
            branch: true,
            scheduleSlot: {
              include: {
                schedule: {
                  include: {
                    doctor: { include: { user: true } },
                    room: true,
                    branch: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!qr || qr.expiresAt <= new Date()) throw new NotFoundException('Mã QR không hợp lệ hoặc đã hết hạn');

    const appt = qr.appointment;
    if (branchId) {
      const apptBranchId = appt.branchId || appt.scheduleSlot?.schedule?.branchId;
      if (apptBranchId && apptBranchId !== branchId) {
        const branchName = appt.branch?.name || appt.scheduleSlot?.schedule?.branch?.name || 'cơ sở khác';
        throw new BadRequestException(`Lịch hẹn này được đặt tại ${branchName}. Vui lòng kiểm tra lại cơ sở khám.`);
      }
    }

    const doctor = appt.scheduleSlot?.schedule?.doctor;
    const room = appt.scheduleSlot?.schedule?.room;
    const branch = appt.branch || appt.scheduleSlot?.schedule?.branch;

    return {
      appointmentId: appt.id,
      bookingCode: appt.bookingCode,
      status: appt.status,
      queueNumber: appt.queueNumber,
      patient: {
        id: appt.patientProfile.id,
        fullName: appt.patientProfile.fullName,
        gender: appt.patientProfile.gender,
        dateOfBirth: appt.patientProfile.dateOfBirth ? appt.patientProfile.dateOfBirth.toISOString().slice(0, 10) : null,
        nationalId: appt.patientProfile.nationalId || '',
        healthInsuranceNumber: appt.patientProfile.healthInsuranceNumber || '',
        phoneNumber: appt.patientProfile.phoneNumber || '',
        address: appt.patientProfile.address || '',
      },
      doctor: doctor ? {
        id: doctor.id,
        fullName: doctor.user?.fullName || '',
      } : null,
      healthPackage: appt.servicePackage ? {
        id: appt.servicePackage.id,
        name: appt.servicePackage.name,
      } : null,
      room: room ? {
        id: room.id,
        code: room.code,
        name: room.name,
      } : null,
      branch: branch ? {
        id: branch.id,
        name: branch.name,
      } : null,
    };
  }

  async checkIn(rawPayload: string, actorId: string | null, channel: 'RECEPTIONIST' = 'RECEPTIONIST', branchId?: string) {
    const rawToken = String(rawPayload || '').trim().replace(/^VITACARE_CHECKIN:/, '');
    if (!rawToken) throw new BadRequestException('Thiếu mã QR check-in');
    const actor = await this.prisma.user.findUnique({ where: { id: actorId || '' }, select: { role: true } });
    if (!actor || !['ADMIN', 'BRANCH_MANAGER', 'RECEPTIONIST'].includes(actor.role)) throw new ForbiddenException('Không có quyền check-in bệnh nhân');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    return this.prisma.$transaction(async (tx) => {
      const qr = await tx.appointmentQrToken.findUnique({
        where: { tokenHash },
        include: { appointment: { include: {
          patientProfile: true,
          servicePackage: true,
          branch: true,
          scheduleSlot: { include: { schedule: { include: { doctor: { include: { user: true } }, room: true, branch: true } } } },
        } } },
      });
      if (!qr || qr.expiresAt <= new Date()) throw new NotFoundException('QR không hợp lệ hoặc đã hết hạn');

      if (branchId) {
        const apptBranchId = qr.appointment.branchId || qr.appointment.scheduleSlot?.schedule?.branchId;
        if (apptBranchId && apptBranchId !== branchId) {
          const branchName = qr.appointment.branch?.name || qr.appointment.scheduleSlot?.schedule?.branch?.name || 'cơ sở khác';
          throw new BadRequestException(`Lịch hẹn này được đặt tại ${branchName}. Vui lòng kiểm tra lại cơ sở khám.`);
        }
      }

      const alreadyCheckedIn = qr.appointment.status === 'CHECKED_IN';
      if (!alreadyCheckedIn && qr.appointment.status !== 'BOOKED') throw new ConflictException('APPOINTMENT_NOT_CHECKIN_READY');
      const assignedDoctorSlotId = qr.appointment.scheduleSlotId;
      if (alreadyCheckedIn) {
        return this.checkInResult(qr.appointment, channel);
      }
      let finalQueueNumber = qr.appointment.queueNumber;
      if (finalQueueNumber == null) {
        finalQueueNumber = await this.computeQueueNumber(
          tx,
          qr.appointment.id,
          qr.appointment.scheduleSlotId,
        );
      }

      const appointment = await tx.appointment.update({
        where: { id: qr.appointment.id },
        data: {
          status: 'CHECKED_IN',
          scheduleSlotId: assignedDoctorSlotId,
          queueNumber: finalQueueNumber,
          checkedInAt: new Date(),
          checkedInById: actorId,
          statusHistories: { create: { fromStatus: 'BOOKED', toStatus: 'CHECKED_IN', actorId, reason: `CHECK_IN_${channel}` } },
        },
        include: { patientProfile: true, servicePackage: true, scheduleSlot: { include: { schedule: { include: { doctor: { include: { user: true } }, room: true, branch: true } } } } },
      });
      await tx.appointmentQrToken.update({ where: { id: qr.id }, data: { usedAt: new Date() } });
      return this.checkInResult(appointment, channel);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private checkInResult(appointment: any, channel: 'RECEPTIONIST' = 'RECEPTIONIST') {
    const room = appointment.scheduleSlot?.schedule?.room;
    const doctor = appointment.scheduleSlot?.schedule?.doctor;
    const doctorName = doctor?.user?.fullName || null;
    return {
      appointmentId: appointment.id,
      bookingCode: appointment.bookingCode,
      queueNumber: appointment.queueNumber,
      status: appointment.status,
      channel,
      checkedInAt: appointment.checkedInAt,
      patient: {
        id: appointment.patientProfile?.id,
        fullName: appointment.patientProfile?.fullName,
        nationalId: appointment.patientProfile?.nationalId,
        phoneNumber: appointment.patientProfile?.phoneNumber,
        gender: appointment.patientProfile?.gender,
        dateOfBirth: appointment.patientProfile?.dateOfBirth,
        address: appointment.patientProfile?.address,
      },
      doctor: doctorName ? { fullName: doctorName } : null,
      healthPackage: appointment.servicePackage ? { name: appointment.servicePackage.name } : null,
      room: room ? { code: room.code, name: room.name } : null,
    };
  }

  /**
   * Bóc tách số CCCD 12 chữ số từ chuỗi nhập vào hoặc mã QR thẻ CCCD Bộ Công An
   * Ví dụ QR CCCD: "079090123456|012345678|Nguyễn Văn A|15031999|Nam|Địa chỉ...|..."
   */
  private extractNationalId(rawInput: string): string {
    const text = String(rawInput || '').trim();
    if (!text) return '';
    if (text.includes('|')) {
      const parts = text.split('|');
      const firstPart = parts[0]?.trim();
      if (/^\d{9,12}$/.test(firstPart)) {
        return firstPart;
      }
    }
    const match = text.match(/\b\d{9,12}\b/);
    if (match) return match[0];
    return text;
  }

  async checkInByNationalId(rawInput: string, actorId: string, branchId?: string) {
    const actor = await this.prisma.user.findUnique({ where: { id: actorId }, select: { role: true } });
    if (!actor || !['ADMIN', 'BRANCH_MANAGER', 'RECEPTIONIST'].includes(actor.role)) {
      throw new ForbiddenException('Không có quyền check-in bệnh nhân');
    }

    const nationalId = this.extractNationalId(rawInput);
    if (!nationalId) {
      throw new BadRequestException('Số CCCD hoặc mã QR thẻ CCCD không hợp lệ');
    }

    const now = new Date();
    const startOfDay = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0));
    const endOfDay = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999));

    // Tìm lịch hẹn hôm nay của bệnh nhân này
    let appt = await this.prisma.appointment.findFirst({
      where: {
        patientProfile: { nationalId },
        status: { in: ['BOOKED', 'CHECKED_IN'] },
        scheduleSlot: {
          schedule: {
            workDate: { gte: startOfDay, lte: endOfDay },
          },
        },
      },
      include: {
        patientProfile: true,
        servicePackage: true,
        branch: true,
        scheduleSlot: {
          include: {
            schedule: {
              include: {
                doctor: { include: { user: true } },
                room: true,
                branch: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Nếu hôm nay không tìm thấy, tìm lịch hẹn trạng thái BOOKED gần nhất
    if (!appt) {
      appt = await this.prisma.appointment.findFirst({
        where: {
          patientProfile: { nationalId },
          status: 'BOOKED',
        },
        include: {
          patientProfile: true,
          servicePackage: true,
          branch: true,
          scheduleSlot: {
            include: {
              schedule: {
                include: {
                  doctor: { include: { user: true } },
                  room: true,
                  branch: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (!appt) {
      throw new NotFoundException(`Không tìm thấy lịch hẹn phù hợp cho số CCCD ${nationalId}`);
    }

    if (branchId) {
      const apptBranchId = appt.branchId || appt.scheduleSlot?.schedule?.branchId;
      if (apptBranchId && apptBranchId !== branchId) {
        const branchName = appt.branch?.name || appt.scheduleSlot?.schedule?.branch?.name || 'cơ sở khác';
        throw new BadRequestException(`Lịch hẹn này được đặt tại ${branchName}. Vui lòng kiểm tra lại cơ sở khám.`);
      }
    }

    if (appt.status === 'CHECKED_IN') {
      return this.checkInResult(appt, 'RECEPTIONIST');
    }

    return this.prisma.$transaction(async (tx) => {
      let finalQueueNumber = appt.queueNumber;
      if (finalQueueNumber == null) {
        finalQueueNumber = await this.computeQueueNumber(
          tx,
          appt.id,
          appt.scheduleSlotId,
        );
      }

      const updated = await tx.appointment.update({
        where: { id: appt.id },
        data: {
          status: 'CHECKED_IN',
          queueNumber: finalQueueNumber,
          checkedInAt: new Date(),
          checkedInById: actorId,
          statusHistories: {
            create: {
              fromStatus: 'BOOKED',
              toStatus: 'CHECKED_IN',
              actorId,
              reason: 'CHECK_IN_NATIONAL_ID',
            },
          },
        },
        include: {
          patientProfile: true,
          servicePackage: true,
          branch: true,
          scheduleSlot: {
            include: {
              schedule: {
                include: {
                  doctor: { include: { user: true } },
                  room: true,
                  branch: true,
                },
              },
            },
          },
        },
      });

      return this.checkInResult(updated, 'RECEPTIONIST');
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  // ─────────────────────────────────────────────────────────────
  // BATCH CHECKOUT – Đặt lịch nhóm All-or-Nothing
  // ─────────────────────────────────────────────────────────────
  /**
   * Đặt lịch cho nhiều thành viên cùng lúc trong 1 transaction.
   * Nếu bất kỳ slot nào hết chỗ → rollback toàn bộ.
   */
  async batchCheckout(accountId: string, dto: BatchCheckoutDto) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Danh sách thành viên không được rỗng');
    }
    const groupType = dto.groupType ?? (dto.items.length === 1 ? 'SINGLE' : 'FAMILY');

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

        const holdTtlMs = this.config.getOrThrow<RabbitMqConfig>('rabbitmq').holdTtlMs;
        const [{ now, expiresAt }] = await tx.$queryRaw<Array<{ now: Date; expiresAt: Date }>>`
          SELECT NOW() AS "now", NOW() + (${holdTtlMs} * INTERVAL '1 millisecond') AS "expiresAt"
        `;

        let totalAmount = new Prisma.Decimal(0);
        const appointmentData: any[] = [];
        const invoiceItems: any[] = [];

        // Khóa & validate từng slot một cách tuần tự (tránh deadlock)
        for (const item of dto.items) {
          const profile = profiles.find((p) => p.id === item.patientProfileId)!;

          if (item.bookingType === 'DOCTOR' || !item.servicePackageId) {
            // ── Đặt theo bác sĩ ──────────────────────────────────
            if (!item.scheduleSlotId) throw new BadRequestException(`Thiếu khung giờ bác sĩ cho ${profile.fullName}`);

            let doctorSlot: any;
            if (item.scheduleSlotId.startsWith('virtual_')) {
              const parts = item.scheduleSlotId.split('_');
              const scheduleId = parts[1];
              const startTimeStr = parts[2];
              const schedule = await (tx as any).doctorSchedule.findUnique({ where: { id: scheduleId }, include: { doctor: true } });
              if (!schedule || schedule.status !== 'OPEN' || !schedule.doctor.isActive) {
                throw new NotFoundException(`Lịch làm việc của bác sĩ không khả dụng cho ${profile.fullName}`);
              }
              const dateStr = schedule.workDate.toISOString().slice(0, 10);
              const startDt = new Date(`${dateStr}T${startTimeStr}:00.000Z`);
              const endDt = new Date(startDt.getTime() + schedule.slotDurationMin * 60_000);
              doctorSlot = await tx.doctorScheduleSlot.upsert({
                where: { scheduleId_startTime: { scheduleId, startTime: startDt } },
                update: {},
                create: { scheduleId, startTime: startDt, endTime: endDt, capacity: schedule.capacityPerSlot ?? 1, occupiedCount: 0 } as any,
                include: { schedule: { include: { doctor: true } } },
              });
            } else {
              const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
              if (!UUID_REGEX.test(item.scheduleSlotId || '')) {
                throw new BadRequestException(`Khung giờ khám không hợp lệ cho ${profile.fullName}. Vui lòng chọn lại khung giờ khám.`);
              }
              doctorSlot = await tx.doctorScheduleSlot.findUnique({
                where: { id: item.scheduleSlotId },
                include: { schedule: { include: { doctor: true } } },
              });
            }
            if (!doctorSlot || !doctorSlot.isActive || doctorSlot.schedule.status !== 'OPEN') {
              throw new NotFoundException(`Khung giờ bác sĩ không khả dụng cho ${profile.fullName}`);
            }

            // Duplicate check
            const dup = await tx.appointment.findFirst({
              where: { patientProfileId: profile.id, scheduleSlotId: doctorSlot.id, status: { in: ACTIVE_APPOINTMENT_STATUSES } },
            });
            if (dup) throw new ConflictException(`${profile.fullName} đã có lịch hẹn trong khung giờ này`);

            // Atomic lock slot
            const reserved = await tx.$executeRaw`
              UPDATE "doctor_schedule_slots"
              SET "occupied_count" = "occupied_count" + 1, "updated_at" = NOW()
              WHERE "id" = ${doctorSlot.id}::uuid
                AND "is_active" = TRUE
                AND "occupied_count" < "capacity"
            `;
            if (reserved !== 1) throw new ConflictException(`Bác sĩ vừa hết chỗ trong khung giờ này (${profile.fullName})`);

            const price = doctorSlot.schedule.doctor.consultationFee;
            totalAmount = totalAmount.add(price);
            appointmentData.push({
              patientProfileId: profile.id,
              branchId: doctorSlot.schedule.branchId,
              scheduleSlotId: doctorSlot.id,
              servicePrice: price,
              symptomsDescription: item.symptomsDescription,
              bookedViaAi: item.bookedViaAi ?? false,
              holdExpiresAt: expiresAt,
            });
            invoiceItems.push({
              description: `Khám với ${doctorSlot.schedule.doctor.fullName} – ${profile.fullName}`,
              quantity: 1,
              unitPrice: price,
              amount: price,
            });
          } else {
            // ── Đặt theo gói dịch vụ ─────────────────────────────
            const slotId = item.scheduleSlotId || item.servicePackageScheduleSlotId;
            const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (!slotId || !UUID_REGEX.test(slotId)) {
              throw new BadRequestException(`Khung giờ khám không hợp lệ cho ${profile.fullName}. Vui lòng chọn lại khung giờ khám.`);
            }
            const pkg = await tx.servicePackage.findUnique({
              where: { id: item.servicePackageId },
              include: { branchBookingMethod: true },
            });
            if (!pkg || !pkg.isActive) {
              throw new NotFoundException(`Gói dịch vụ không khả dụng cho ${profile.fullName}`);
            }

            const doctorSlot = await tx.doctorScheduleSlot.findUnique({
              where: { id: slotId },
              include: { schedule: { include: { doctor: true } } },
            });
            if (!doctorSlot || !doctorSlot.isActive || doctorSlot.schedule.status !== 'OPEN') {
              throw new NotFoundException(`Khung giờ khám không khả dụng cho ${profile.fullName}`);
            }

            const dup = await tx.appointment.findFirst({
              where: { patientProfileId: profile.id, scheduleSlotId: doctorSlot.id, status: { in: ACTIVE_APPOINTMENT_STATUSES } },
            });
            if (dup) throw new ConflictException(`${profile.fullName} đã có lịch hẹn trong khung giờ này`);

            const reserved = await tx.$executeRaw`
              UPDATE "doctor_schedule_slots"
              SET "occupied_count" = "occupied_count" + 1, "updated_at" = NOW()
              WHERE "id" = ${doctorSlot.id}::uuid
                AND "is_active" = TRUE
                AND "occupied_count" < "capacity"
            `;
            if (reserved !== 1) throw new ConflictException(`Khung giờ khám hết chỗ (${profile.fullName})`);

            totalAmount = totalAmount.add(pkg.price);
            appointmentData.push({
              patientProfileId: profile.id,
              branchId: pkg.branchBookingMethod.branchId,
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

        const subtotal = Number(totalAmount);
        const serviceFee = BOOKING_SERVICE_FEE;
        let discountAmount = 0;
        let voucherApplied: any = null;
        if (dto.voucherCode) {
          const vResult = await this.vouchersService.validateVoucher(dto.voucherCode, subtotal, accountId);
          discountAmount = vResult.discountAmount;
          voucherApplied = vResult.voucher;
        }
        const finalTotalAmount = Math.max(0, subtotal + serviceFee - discountAmount);

        invoiceItems.push({
          description: 'Phí tiện ích dịch vụ (Ưu đãi đơn nhóm)',
          quantity: 1,
          unitPrice: new Prisma.Decimal(serviceFee),
          amount: new Prisma.Decimal(serviceFee),
        });
        if (discountAmount > 0 && voucherApplied) {
          invoiceItems.push({
            description: `Mã ưu đãi (${voucherApplied.code})`,
            quantity: 1,
            unitPrice: new Prisma.Decimal(-discountAmount),
            amount: new Prisma.Decimal(-discountAmount),
          });
        }

        // Tạo BookingOrder tổng
        const orderCode = `ORD-${Date.now().toString(36).toUpperCase()}`;
        const branchId = appointmentData[0]?.branchId;
        const bookingOrder = await (tx as any).bookingOrder.create({
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
                statusHistories: { create: { toStatus: 'PENDING_PAYMENT', actorId: accountId } },
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
          } as any,
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
      if (error instanceof ConflictException || error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Lịch hẹn bị trùng. Vui lòng chọn lại khung giờ');
      }
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // GỢI Ý KHUNG GIỜ SONG SONG / LIÊN TIẾP
  // ─────────────────────────────────────────────────────────────
  /**
   * Gợi ý xếp N thành viên vào cùng khung giờ (song song)
   * hoặc các khung giờ liên tiếp gần nhất.
   */
  async suggestParallelSlots(branchId: string, date: string, memberCount: number, specialtyId?: number) {
    if (!branchId || !date) throw new BadRequestException('Thiếu branchId hoặc date');
    if (memberCount < 1 || memberCount > 10) throw new BadRequestException('Số thành viên phải từ 1 đến 10');

    const workDate = (() => {
      const d = new Date(`${date}T00:00:00.000Z`);
      if (Number.isNaN(d.getTime())) throw new BadRequestException('Ngày không hợp lệ');
      return d;
    })();

    // Lấy tất cả slot còn chỗ trong ngày tại chi nhánh
    const slots = await this.prisma.doctorScheduleSlot.findMany({
      where: {
        isActive: true,
        slotStatus: 'AVAILABLE' as any,
        schedule: {
          branchId,
          workDate,
          status: 'OPEN',
          doctor: {
            isActive: true,
            ...(specialtyId ? { specialties: { some: { specialtyId } } } : {}),
          },
        },
      },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        capacity: true,
        occupiedCount: true,
        schedule: {
          select: {
            doctor: { select: { id: true, academicRank: true, consultationFee: true, user: { select: { fullName: true } } } },
          },
        },
      },
      orderBy: [{ startTime: 'asc' }, { occupiedCount: 'asc' }],
    });

    // Nhóm slot theo startTime
    const byTime = new Map<string, typeof slots>();
    for (const slot of slots) {
      if (slot.capacity - slot.occupiedCount < 1) continue;
      const key = slot.startTime.toISOString().slice(11, 16);
      if (!byTime.has(key)) byTime.set(key, []);
      byTime.get(key)!.push(slot);
    }

    // Tìm khung giờ có đủ N bác sĩ khác nhau cùng lúc
    const parallelOptions: any[] = [];
    for (const [time, slotsAtTime] of byTime.entries()) {
      if (slotsAtTime.length >= memberCount) {
        parallelOptions.push({
          type: 'PARALLEL',
          startTime: time,
          slots: slotsAtTime.slice(0, memberCount).map((s) => ({
            slotId: s.id,
            doctor: s.schedule.doctor ? { id: s.schedule.doctor.id, fullName: s.schedule.doctor.user?.fullName ?? '', academicRank: s.schedule.doctor.academicRank, consultationFee: s.schedule.doctor.consultationFee } : null,
            startTime: s.startTime.toISOString().slice(11, 16),
            endTime: s.endTime.toISOString().slice(11, 16),
            remainingCapacity: s.capacity - s.occupiedCount,
          })),
        });
      }
    }

    // Tìm dãy liên tiếp
    const sequentialOptions: any[] = [];
    const timeKeys = Array.from(byTime.keys()).sort();
    for (let i = 0; i <= timeKeys.length - memberCount; i++) {
      const candidate = timeKeys.slice(i, i + memberCount);
      const slotGroup = candidate.map((t) => byTime.get(t)![0]).filter(Boolean);
      if (slotGroup.length === memberCount) {
        sequentialOptions.push({
          type: 'SEQUENTIAL',
          startTime: candidate[0],
          endTime: candidate[candidate.length - 1],
          slots: slotGroup.map((s) => ({
            slotId: s.id,
            doctor: s.schedule.doctor ? { id: s.schedule.doctor.id, fullName: s.schedule.doctor.user?.fullName ?? '', academicRank: s.schedule.doctor.academicRank, consultationFee: s.schedule.doctor.consultationFee } : null,
            startTime: s.startTime.toISOString().slice(11, 16),
            endTime: s.endTime.toISOString().slice(11, 16),
            remainingCapacity: s.capacity - s.occupiedCount,
          })),
        });
      }
    }

    return {
      date,
      branchId,
      memberCount,
      parallelOptions: parallelOptions.slice(0, 5),
      sequentialOptions: sequentialOptions.slice(0, 5),
    };
  }

  private async computeQueueNumber(
    tx: Prisma.TransactionClient,
    appointmentId: string,
    scheduleSlotId?: string | null,
  ): Promise<number> {
    if (scheduleSlotId) {
      const currSlot = await tx.doctorScheduleSlot.findUnique({
        where: { id: scheduleSlotId },
      });
      if (currSlot) {
        const earlierSlots = await tx.doctorScheduleSlot.findMany({
          where: {
            scheduleId: currSlot.scheduleId,
            isActive: true,
            startTime: { lt: currSlot.startTime },
          },
          select: { capacity: true },
        });
        const priorCapacity = earlierSlots.reduce((sum, s) => sum + (s.capacity || 1), 0);
        const bookedInCurrentSlot = await tx.appointment.count({
          where: {
            scheduleSlotId: currSlot.id,
            queueNumber: { not: null },
            id: { not: appointmentId },
          },
        });
        return priorCapacity + bookedInCurrentSlot + 1;
      }
    }

    return 1;
  }

  private async confirmPaid(tx: Prisma.TransactionClient, paymentId: string, invoiceId: string, appointmentId: string, provider: string, dto: PaymentWebhookDto, late: boolean) {
    const rawToken = this.checkInToken(appointmentId);
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const bookingCode = `VC-${appointmentId.slice(0, 8).toUpperCase()}`;

    // Cấp số thứ tự cố định chuẩn theo thứ tự khung giờ trong ngày làm việc của Bác sĩ
    const existingAppt = await tx.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        scheduleSlot: true,
      },
    });

    let assignedQueueNumber = existingAppt?.queueNumber ?? null;
    if (assignedQueueNumber == null && existingAppt) {
      assignedQueueNumber = await this.computeQueueNumber(
        tx,
        appointmentId,
        existingAppt.scheduleSlotId,
      );
    }

    await tx.paymentTransaction.update({ where: { id: paymentId }, data: { provider, providerTransactionId: dto.providerTransactionId, status: late ? 'LATE_SUCCESS' : 'SUCCESS', paidAt: new Date(), rawPayload: dto.payload as Prisma.InputJsonValue } });
    await tx.invoice.update({ where: { id: invoiceId }, data: { status: 'PAID', paidAt: new Date() } });
    const appointment = await tx.appointment.update({
      where: { id: appointmentId },
      data: {
        status: 'BOOKED',
        bookingCode,
        queueNumber: assignedQueueNumber,
        holdExpiresAt: null,
        statusHistories: { create: { fromStatus: late ? 'EXPIRED' : 'PENDING_PAYMENT', toStatus: 'BOOKED', reason: late ? 'LATE_SUCCESS_CAPACITY_REACQUIRED' : 'PAYMENT_SUCCESS' } },
      },
      include: {
        patientProfile: true,
        scheduleSlot: {
          include: {
            schedule: {
              include: {
                doctor: {
                  include: { user: true },
                },
              },
            },
          },
        },
      },
    });
    await tx.appointmentQrToken.upsert({ where: { appointmentId }, update: { tokenHash, expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000), usedAt: null }, create: { appointmentId, tokenHash, expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000) } });
    await tx.outboxEvent.create({ data: { aggregateType: 'Appointment', aggregateId: appointmentId, eventType: 'appointment.booked', payload: { appointmentId, bookingCode, queueNumber: assignedQueueNumber, lateSuccess: late } } });
    
    // Bắn sự kiện realtime socket tới Quầy tiếp đón & Bác sĩ
    try {
      this.realtimeGateway.emitAppointmentBooked({
        appointmentId,
        bookingCode,
        queueNumber: assignedQueueNumber ?? undefined,
        patientName: appointment.patientProfile?.fullName,
        patientPhone: appointment.patientProfile?.phoneNumber,
        doctorName: appointment.scheduleSlot?.schedule?.doctor?.user?.fullName,
        branchId: appointment.branchId,
        appointmentDate: appointment.scheduleSlot?.schedule?.workDate?.toISOString().slice(0, 10),
        startTime: appointment.scheduleSlot?.startTime?.toISOString().slice(11, 16),
        endTime: appointment.scheduleSlot?.endTime?.toISOString().slice(11, 16),
        status: 'BOOKED',
      });
    } catch {
      // Ignore socket emit error
    }

    return { status: late ? PaymentStatus.LATE_SUCCESS : PaymentStatus.SUCCESS, appointmentStatus: appointment.status, bookingCode, queueNumber: assignedQueueNumber, qrToken: rawToken };
  }

  private async confirmPaidBatch(
    tx: Prisma.TransactionClient,
    paymentId: string,
    invoiceId: string,
    bookingOrderId: string,
    appointments: any[],
    provider: string,
    dto: PaymentWebhookDto,
  ) {
    await tx.paymentTransaction.update({
      where: { id: paymentId },
      data: {
        provider,
        providerTransactionId: dto.providerTransactionId,
        status: 'SUCCESS',
        paidAt: new Date(),
        rawPayload: dto.payload as Prisma.InputJsonValue,
      },
    });

    await tx.invoice.update({
      where: { id: invoiceId },
      data: { status: 'PAID', paidAt: new Date() },
    });

    await (tx as any).bookingOrder.update({
      where: { id: bookingOrderId },
      data: { status: 'PAID' },
    });

    const confirmedAppointments: any[] = [];

    for (const appt of appointments) {
      const rawToken = this.checkInToken(appt.id);
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const bookingCode = `VC-${appt.id.slice(0, 8).toUpperCase()}`;

      let assignedQueueNumber = appt.queueNumber ?? null;
      if (assignedQueueNumber == null) {
        assignedQueueNumber = await this.computeQueueNumber(
          tx,
          appt.id,
          appt.scheduleSlotId,
        );
      }

      const updated = await tx.appointment.update({
        where: { id: appt.id },
        data: {
          status: 'BOOKED',
          bookingCode,
          queueNumber: assignedQueueNumber,
          holdExpiresAt: null,
          statusHistories: {
            create: {
              fromStatus: 'PENDING_PAYMENT',
              toStatus: 'BOOKED',
              reason: 'PAYMENT_SUCCESS_BATCH',
            },
          },
        },
        include: {
          patientProfile: true,
          scheduleSlot: {
            include: {
              schedule: {
                include: {
                  doctor: {
                    include: { user: true },
                  },
                },
              },
            },
          },
        },
      });

      await tx.appointmentQrToken.upsert({
        where: { appointmentId: appt.id },
        update: {
          tokenHash,
          expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
          usedAt: null,
        },
        create: {
          appointmentId: appt.id,
          tokenHash,
          expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        },
      });

      await tx.outboxEvent.create({
        data: {
          aggregateType: 'Appointment',
          aggregateId: appt.id,
          eventType: 'appointment.booked',
          payload: {
            appointmentId: appt.id,
            bookingCode,
            bookingOrderId,
            queueNumber: assignedQueueNumber,
          },
        },
      });

      // Bắn sự kiện realtime socket cho từng lịch hẹn trong gói gia đình
      try {
        this.realtimeGateway.emitAppointmentBooked({
          appointmentId: updated.id,
          bookingCode,
          queueNumber: assignedQueueNumber ?? undefined,
          patientName: updated.patientProfile?.fullName,
          patientPhone: updated.patientProfile?.phoneNumber,
          doctorName: updated.scheduleSlot?.schedule?.doctor?.user?.fullName,
          branchId: updated.branchId,
          appointmentDate: updated.scheduleSlot?.schedule?.workDate?.toISOString().slice(0, 10),
          startTime: updated.scheduleSlot?.startTime?.toISOString().slice(11, 16),
          endTime: updated.scheduleSlot?.endTime?.toISOString().slice(11, 16),
          status: 'BOOKED',
        });
      } catch {
        // Ignore socket emit error
      }

      confirmedAppointments.push({
        appointmentId: updated.id,
        bookingCode,
        queueNumber: assignedQueueNumber,
      });
    }

    return {
      status: PaymentStatus.SUCCESS,
      appointmentStatus: 'BOOKED',
      bookingOrderId,
      appointments: confirmedAppointments,
    };
  }
}
