import { Injectable, NotFoundException } from '@nestjs/common';
import { AppointmentStatus, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { AppointmentConfirmationService, ConfirmedAppointment } from '../appointments/appointment-confirmation.service.js';
import { computeQueueNumber, releaseAppointmentSlot } from '../appointments/helpers/appointment.helper.js';
import { releaseVoucherUsage } from '../vouchers/vouchers.service.js';
import { PaymentWebhookDto } from './dtos/payment-webhook.dto.js';

@Injectable()
export class PaymentSettlementService {
  constructor(private readonly prisma: PrismaService, private readonly confirmations: AppointmentConfirmationService) { }

  async handlePaymentWebhook(provider: string, dto: PaymentWebhookDto) {
    // Concurrent deliveries can both read PENDING. Only the committed attempt may notify.
    for (let attempt = 0; ; attempt++) {
      const snapshots: ConfirmedAppointment[] = [];
      const result = await this.prisma.$transaction(
        tx => this.settlePayment(tx, provider, dto, snapshots),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ).catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 2) return null;
        throw error;
      });
      if (!result) continue;
      for (const snapshot of snapshots) await this.confirmations.notifyConfirmedAppointment(snapshot);
      return result;
    }
  }

  private async settlePayment(
    tx: Prisma.TransactionClient, provider: string, dto: PaymentWebhookDto, snapshots: ConfirmedAppointment[],
  ) {
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
    if (['SUCCESS', 'REFUNDED', 'REFUND_REQUIRED'].includes(payment.status)
      || (payment.status === 'FAILED' && dto.status === 'FAILED')) {
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
      if (!bookingOrder.appointments.length || bookingOrder.appointments.some(appt => appt.status !== 'HOLD')) {
        return this.markRefundRequired(tx, payment.id, payment.invoiceId, bookingOrder.appointments, provider, dto, bookingOrder.id, payment.invoice.status === 'PAID');
      }
      return this.confirmPaidBatch(tx, payment.id, payment.invoiceId, bookingOrder.id, bookingOrder.appointments, provider, dto, snapshots);
    }

    const appointment = payment.invoice.appointment;
    if (appointment) {
      // A HOLD still owns its capacity, including while expiry reconciliation is running.
      if (appointment.status === 'HOLD') {
        return this.confirmPaid(tx, payment.id, payment.invoiceId, appointment.id, provider, dto, snapshots);
      }
      if (appointment.status === 'CANCELLED') return this.markRefundRequired(tx, payment.id, payment.invoiceId, [appointment], provider, dto);
      return { status: payment.status, appointmentStatus: appointment.status };
    }
    return { status: payment.status, appointmentStatus: 'UNKNOWN' };
  }

  private async markRefundRequired(
    tx: Prisma.TransactionClient, paymentId: string, invoiceId: string,
    appointments: { id: string; status: AppointmentStatus; scheduleSlotId: string | null }[],
    provider: string, dto: PaymentWebhookDto, bookingOrderId?: string, alreadyPaid = false,
  ) {
    for (const appointment of appointments) {
      if (appointment.status !== 'HOLD') continue;
      const changed = await tx.appointment.updateMany({ where: { id: appointment.id, status: 'HOLD' }, data: { status: 'CANCELLED' } });
      if (!changed.count) continue;
      await releaseAppointmentSlot(tx, appointment.scheduleSlotId);
      await tx.appointmentStatusHistory.create({ data: {
        appointmentId: appointment.id, fromStatus: 'HOLD', toStatus: 'CANCELLED', reason: 'LATE_PAYMENT_REFUND_REQUIRED',
      } });
    }
    if (!alreadyPaid) {
      await tx.invoice.update({ where: { id: invoiceId }, data: { status: 'CANCELLED' } });
      if (bookingOrderId) await tx.bookingOrder.update({ where: { id: bookingOrderId }, data: { status: 'CANCELLED' } });
      if (bookingOrderId || appointments[0]) await releaseVoucherUsage(tx, bookingOrderId ? { bookingOrderId } : { appointmentId: appointments[0].id });
    }
    await tx.paymentTransaction.update({ where: { id: paymentId }, data: {
      provider, providerTransactionId: dto.providerTransactionId, status: 'REFUND_REQUIRED', paidAt: new Date(), rawPayload: dto.payload as Prisma.InputJsonValue,
    } });
    await tx.outboxEvent.create({ data: {
      aggregateType: 'PaymentTransaction', aggregateId: paymentId, eventType: 'payment.refund.required',
      payload: { paymentId, invoiceId, ...(bookingOrderId ? { bookingOrderId } : {}), appointmentIds: appointments.map(appt => appt.id), reason: 'LATE_SUCCESS_CANCELLED_BOOKING' },
    } });
    return { status: PaymentStatus.REFUND_REQUIRED, appointmentStatus: alreadyPaid ? AppointmentStatus.CONFIRMED : AppointmentStatus.CANCELLED };
  }

  private async confirmPaid(
    tx: Prisma.TransactionClient,
    paymentId: string,
    invoiceId: string,
    appointmentId: string,
    provider: string,
    dto: PaymentWebhookDto,
    snapshots: ConfirmedAppointment[],
  ) {
    // Cấp số thứ tự cố định chuẩn theo thứ tự khung giờ trong ngày làm việc của Bác sĩ
    const existingAppt = await tx.appointment.findUnique({
      where: { id: appointmentId },
      include: { scheduleSlot: true },
    });

    let assignedQueueNumber = existingAppt?.queueNumber ?? null;
    if (assignedQueueNumber == null && existingAppt) {
      assignedQueueNumber = await computeQueueNumber(tx, appointmentId, existingAppt.scheduleSlotId);
    }

    await tx.paymentTransaction.update({ where: { id: paymentId }, data: { provider, providerTransactionId: dto.providerTransactionId, status: 'SUCCESS', paidAt: new Date(), rawPayload: dto.payload as Prisma.InputJsonValue } });
    await tx.invoice.update({ where: { id: invoiceId }, data: { status: 'PAID', paidAt: new Date() } });

    const { rawToken, updated: appointment } = await this.confirmations.confirmSingleAppointment(tx, appointmentId, assignedQueueNumber, AppointmentStatus.HOLD, 'PAYMENT_SUCCESS');

    snapshots.push(appointment);
    return { status: PaymentStatus.SUCCESS, appointmentStatus: appointment.status, bookingCode: appointment.bookingCode!, queueNumber: assignedQueueNumber, qrToken: rawToken };
  }

  private async confirmPaidBatch(
    tx: Prisma.TransactionClient,
    paymentId: string,
    invoiceId: string,
    bookingOrderId: string,
    appointments: any[],
    provider: string,
    dto: PaymentWebhookDto,
    snapshots: ConfirmedAppointment[],
  ) {
    await tx.paymentTransaction.update({
      where: { id: paymentId },
      data: { provider, providerTransactionId: dto.providerTransactionId, status: 'SUCCESS', paidAt: new Date(), rawPayload: dto.payload as Prisma.InputJsonValue },
    });
    await tx.invoice.update({ where: { id: invoiceId }, data: { status: 'PAID', paidAt: new Date() } });
    await (tx as any).bookingOrder.update({ where: { id: bookingOrderId }, data: { status: 'PAID' } });

    const confirmedAppointments: any[] = [];
    for (const appt of appointments) {
      let assignedQueueNumber = appt.queueNumber ?? null;
      if (assignedQueueNumber == null) {
        assignedQueueNumber = await computeQueueNumber(tx, appt.id, appt.scheduleSlotId);
      }

      const { updated } = await this.confirmations.confirmSingleAppointment(tx, appt.id, assignedQueueNumber, 'HOLD' as AppointmentStatus, 'PAYMENT_SUCCESS_BATCH', bookingOrderId);
      snapshots.push(updated);
      confirmedAppointments.push({ appointmentId: updated.id, bookingCode: updated.bookingCode, queueNumber: assignedQueueNumber });
    }

    return { status: PaymentStatus.SUCCESS, appointmentStatus: 'CONFIRMED', bookingOrderId, appointments: confirmedAppointments };
  }
}
