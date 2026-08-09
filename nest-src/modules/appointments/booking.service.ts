import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppointmentStatus, PaymentStatus, Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { RabbitMqConfig } from '../../config/config.type.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { CheckoutAppointmentDto } from './dtos/checkout-appointment.dto.js';
import { PaymentWebhookDto } from './dtos/payment-webhook.dto.js';

const ACTIVE_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  'PENDING_PAYMENT', 'BOOKED', 'CHECKED_IN', 'IN_EXAMINATION',
];

@Injectable()
export class BookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async checkout(accountId: string, dto: CheckoutAppointmentDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const profile = await tx.patientProfile.findFirst({
          where: { id: dto.patientProfileId, accountId },
        });
        if (!profile) throw new NotFoundException('Không tìm thấy hồ sơ bệnh nhân');

        const slot = await tx.doctorScheduleSlot.findUnique({
          where: { id: dto.scheduleSlotId },
          include: { schedule: { include: { doctor: true } } },
        });
        if (!slot || !slot.isActive || slot.schedule.status !== 'OPEN') {
          throw new NotFoundException('Khung giờ không khả dụng');
        }

        const duplicate = await tx.appointment.findFirst({
          where: {
            patientProfileId: profile.id,
            scheduleSlotId: slot.id,
            status: { in: ACTIVE_APPOINTMENT_STATUSES },
          },
        });
        if (duplicate) {
          throw new ConflictException('Người bệnh đã có lịch hẹn trong khung giờ này');
        }

        const reserved = await tx.$executeRaw`
          UPDATE "doctor_schedule_slots"
          SET "occupied_count" = "occupied_count" + 1,
              "updated_at" = NOW()
          WHERE "id" = ${slot.id}::uuid
            AND "is_active" = TRUE
            AND "occupied_count" < "capacity"
        `;
        if (reserved !== 1) throw new ConflictException('Khung giờ này vừa hết chỗ');

        const holdTtlMs = this.config.getOrThrow<RabbitMqConfig>('rabbitmq').holdTtlMs;
        const [{ now, expiresAt }] = await tx.$queryRaw<Array<{ now: Date; expiresAt: Date }>>`
          SELECT
            NOW() AS "now",
            NOW() + (${holdTtlMs} * INTERVAL '1 millisecond') AS "expiresAt"
        `;
        const appointment = await tx.appointment.create({
          data: {
            patientProfileId: profile.id,
            doctorId: slot.schedule.doctorId,
            branchId: slot.schedule.branchId,
            scheduleSlotId: slot.id,
            symptomsDescription: dto.symptomsDescription,
            bookedViaAi: dto.bookedViaAi ?? false,
            holdExpiresAt: expiresAt,
            statusHistories: { create: { toStatus: 'PENDING_PAYMENT', actorId: accountId } },
          },
        });
        const invoice = await tx.invoice.create({
          data: {
            appointmentId: appointment.id,
            patientProfileId: profile.id,
            branchId: slot.schedule.branchId,
            totalAmount: slot.schedule.doctor.consultationFee,
            items: { create: { description: 'Phí khám', quantity: 1, unitPrice: slot.schedule.doctor.consultationFee, amount: slot.schedule.doctor.consultationFee } },
          },
        });
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
            payload: { appointmentId: appointment.id, slotId: slot.id, holdExpiresAt: expiresAt.toISOString() },
          },
        });
        return { appointmentId: appointment.id, invoiceId: invoice.id, paymentId: payment.id, status: appointment.status, holdStartedAt: now, holdExpiresAt: expiresAt };
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
      await tx.$executeRaw`
        UPDATE "doctor_schedule_slots"
        SET "occupied_count" = GREATEST("occupied_count" - 1, 0), "updated_at" = NOW()
        WHERE "id" = ${appointment.scheduleSlotId}::uuid
      `;
      await tx.paymentTransaction.updateMany({ where: { invoice: { appointmentId }, status: 'PENDING' }, data: { status: 'EXPIRED' } });
      await tx.appointmentStatusHistory.create({ data: { appointmentId, fromStatus: 'PENDING_PAYMENT', toStatus: 'EXPIRED', reason: 'PAYMENT_HOLD_TIMEOUT' } });
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async handlePaymentWebhook(provider: string, dto: PaymentWebhookDto) {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.paymentTransaction.findUnique({
        where: { id: dto.paymentId }, include: { invoice: { include: { appointment: true } } },
      });
      if (!payment) throw new NotFoundException('Không tìm thấy giao dịch');
      if (payment.providerTransactionId === dto.providerTransactionId && ['SUCCESS', 'LATE_SUCCESS', 'REFUND_REQUIRED', 'MANUAL_REVIEW'].includes(payment.status)) {
        return { status: payment.status, appointmentStatus: payment.invoice.appointment.status };
      }
      if (dto.status === 'FAILED') {
        await tx.paymentTransaction.update({ where: { id: payment.id }, data: { provider, providerTransactionId: dto.providerTransactionId, status: 'FAILED', rawPayload: dto.payload as Prisma.InputJsonValue } });
        return { status: PaymentStatus.FAILED, appointmentStatus: payment.invoice.appointment.status };
      }
      const appointment = payment.invoice.appointment;
      if (appointment.status === 'PENDING_PAYMENT' && appointment.holdExpiresAt && appointment.holdExpiresAt > new Date()) {
        return this.confirmPaid(tx, payment.id, payment.invoiceId, appointment.id, provider, dto, false);
      }
      if (appointment.status === 'EXPIRED') {
        const reserved = await tx.$executeRaw`
          UPDATE "doctor_schedule_slots" SET "occupied_count" = "occupied_count" + 1, "updated_at" = NOW()
          WHERE "id" = ${appointment.scheduleSlotId}::uuid AND "occupied_count" < "capacity" AND "is_active" = TRUE
        `;
        if (reserved === 1) return this.confirmPaid(tx, payment.id, payment.invoiceId, appointment.id, provider, dto, true);
        await tx.paymentTransaction.update({ where: { id: payment.id }, data: { provider, providerTransactionId: dto.providerTransactionId, status: 'REFUND_REQUIRED', paidAt: new Date(), rawPayload: dto.payload as Prisma.InputJsonValue } });
        await tx.appointment.update({ where: { id: appointment.id }, data: { status: 'REFUND_REQUIRED', statusHistories: { create: { fromStatus: 'EXPIRED', toStatus: 'REFUND_REQUIRED', reason: 'LATE_SUCCESS_SLOT_FULL' } } } });
        await tx.outboxEvent.create({ data: { aggregateType: 'PaymentTransaction', aggregateId: payment.id, eventType: 'payment.refund.required', payload: { paymentId: payment.id, appointmentId: appointment.id, reason: 'LATE_SUCCESS_SLOT_FULL' } } });
        return { status: PaymentStatus.REFUND_REQUIRED, appointmentStatus: AppointmentStatus.REFUND_REQUIRED };
      }
      return { status: payment.status, appointmentStatus: appointment.status };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async paymentStatus(appointmentId: string, accountId: string) {
    const row = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, patientProfile: { accountId } },
      include: { invoice: { include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } } }, qrToken: true },
    });
    if (!row) throw new NotFoundException('Không tìm thấy lịch hẹn');
    return { appointmentId: row.id, status: row.status, holdExpiresAt: row.holdExpiresAt, paymentStatus: row.invoice?.payments[0]?.status ?? null, hasQr: Boolean(row.qrToken) };
  }

  async checkIn(rawToken: string, actorId: string) {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    return this.prisma.$transaction(async (tx) => {
      const qr = await tx.appointmentQrToken.findUnique({ where: { tokenHash }, include: { appointment: true } });
      if (!qr || qr.expiresAt <= new Date()) throw new NotFoundException('QR không hợp lệ hoặc đã hết hạn');
      if (qr.appointment.status === 'CHECKED_IN') return { appointmentId: qr.appointment.id, queueNumber: qr.appointment.queueNumber, status: qr.appointment.status };
      if (qr.appointment.status !== 'BOOKED') throw new ConflictException('APPOINTMENT_NOT_CHECKIN_READY');
      const [counter] = await tx.$queryRaw<Array<{ nextQueueNumber: number }>>`
        UPDATE "doctor_schedule_slots"
        SET "next_queue_number" = "next_queue_number" + 1, "updated_at" = NOW()
        WHERE "id" = ${qr.appointment.scheduleSlotId}::uuid
        RETURNING "next_queue_number" AS "nextQueueNumber"
      `;
      const appointment = await tx.appointment.update({ where: { id: qr.appointment.id }, data: { status: 'CHECKED_IN', queueNumber: counter.nextQueueNumber, checkedInAt: new Date(), checkedInById: actorId, statusHistories: { create: { fromStatus: 'BOOKED', toStatus: 'CHECKED_IN', actorId } } } });
      await tx.appointmentQrToken.update({ where: { id: qr.id }, data: { usedAt: new Date() } });
      return { appointmentId: appointment.id, queueNumber: appointment.queueNumber, status: appointment.status };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async confirmPaid(tx: Prisma.TransactionClient, paymentId: string, invoiceId: string, appointmentId: string, provider: string, dto: PaymentWebhookDto, late: boolean) {
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const bookingCode = `VC-${appointmentId.slice(0, 8).toUpperCase()}`;
    await tx.paymentTransaction.update({ where: { id: paymentId }, data: { provider, providerTransactionId: dto.providerTransactionId, status: late ? 'LATE_SUCCESS' : 'SUCCESS', paidAt: new Date(), rawPayload: dto.payload as Prisma.InputJsonValue } });
    await tx.invoice.update({ where: { id: invoiceId }, data: { status: 'PAID', paidAt: new Date() } });
    const appointment = await tx.appointment.update({ where: { id: appointmentId }, data: { status: 'BOOKED', bookingCode, holdExpiresAt: null, statusHistories: { create: { fromStatus: late ? 'EXPIRED' : 'PENDING_PAYMENT', toStatus: 'BOOKED', reason: late ? 'LATE_SUCCESS_CAPACITY_REACQUIRED' : 'PAYMENT_SUCCESS' } } } });
    await tx.appointmentQrToken.upsert({ where: { appointmentId }, update: { tokenHash, expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000), usedAt: null }, create: { appointmentId, tokenHash, expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000) } });
    await tx.outboxEvent.create({ data: { aggregateType: 'Appointment', aggregateId: appointmentId, eventType: 'appointment.booked', payload: { appointmentId, bookingCode, lateSuccess: late } } });
    return { status: late ? PaymentStatus.LATE_SUCCESS : PaymentStatus.SUCCESS, appointmentStatus: appointment.status, bookingCode, qrToken: rawToken };
  }
}
