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
        appointmentStatus: payment.invoice.bookingOrder.appointments[0]?.status ?? null,
      };
    }
    if (dto.status === 'FAILED') {
      await tx.paymentTransaction.update({
        where: { id: payment.id },
        data: { provider, providerTransactionId: dto.providerTransactionId, status: 'FAILED', rawPayload: dto.payload as Prisma.InputJsonValue },
      });
      return {
        status: PaymentStatus.FAILED,
        appointmentStatus: payment.invoice.bookingOrder.appointments[0]?.status ?? null,
      };
    }

    if (payment.invoice.status === 'PAID') {
      const appointments = payment.invoice.bookingOrder.appointments;
      return this.markRefundRequired(tx, payment.id, payment.invoiceId, appointments, provider, dto, payment.invoice.bookingOrderId, true);
    }

    // Xử lý đơn tổng BookingOrder (Batch Payment)
    const bookingOrder = payment.invoice.bookingOrder;
    if (!['UNPAID', 'PENDING_PAYMENT'].includes(bookingOrder.status) || !bookingOrder.appointments.length || bookingOrder.appointments.some(appt => appt.status !== 'HOLD')) {
      return this.markRefundRequired(tx, payment.id, payment.invoiceId, bookingOrder.appointments, provider, dto, bookingOrder.id);
    }
    return this.confirmPaidBatch(tx, payment.id, payment.invoiceId, bookingOrder.id, bookingOrder.appointments, provider, dto, snapshots);
  }

  private async markRefundRequired(
    tx: Prisma.TransactionClient, paymentId: string, invoiceId: string,
    appointments: { id: string; status: AppointmentStatus; scheduleSlotId: number | null; receptionSlotId?: number | null }[],
    provider: string, dto: PaymentWebhookDto, bookingOrderId: string, alreadyPaid = false,
  ) {
    for (const appointment of appointments) {
      if (appointment.status !== 'HOLD') continue;
      const changed = await tx.appointment.updateMany({ where: { id: appointment.id, status: 'HOLD' }, data: { status: 'CANCELLED' } });
      if (!changed.count) continue;
      await releaseAppointmentSlot(tx, appointment.scheduleSlotId, appointment.receptionSlotId);
      await tx.appointmentStatusHistory.create({ data: {
        appointmentId: appointment.id, fromStatus: 'HOLD', toStatus: 'CANCELLED', reason: 'LATE_PAYMENT_REFUND_REQUIRED',
      } });
    }
    if (!alreadyPaid) {
      await tx.invoice.update({ where: { id: invoiceId }, data: { status: 'CANCELLED' } });
      await tx.bookingOrder.update({ where: { id: bookingOrderId }, data: { status: 'CANCELLED' } });
      await releaseVoucherUsage(tx, { bookingOrderId });
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

  private async confirmPaidBatch(
    tx: Prisma.TransactionClient,
    paymentId: string,
    invoiceId: string,
    bookingOrderId: string,
    appointments: Prisma.AppointmentGetPayload<{}>[],
    provider: string,
    dto: PaymentWebhookDto,
    snapshots: ConfirmedAppointment[],
  ) {
    await tx.paymentTransaction.update({
      where: { id: paymentId },
      data: { provider, providerTransactionId: dto.providerTransactionId, status: 'SUCCESS', paidAt: new Date(), rawPayload: dto.payload as Prisma.InputJsonValue },
    });
    await tx.invoice.update({ where: { id: invoiceId }, data: { status: 'PAID', paidAt: new Date() } });
    await tx.bookingOrder.update({ where: { id: bookingOrderId }, data: { status: 'PAID' } });

    const confirmedAppointments: { appointmentId: string; bookingCode: string | null; queueNumber: number | null }[] = [];
    let singleConfirmation: { bookingCode: string | null; queueNumber: number | null; qrToken: string } | undefined;
    for (const appt of appointments) {
      let assignedQueueNumber = appt.queueNumber ?? null;
      if (assignedQueueNumber == null && !appt.receptionSlotId) {
        assignedQueueNumber = await computeQueueNumber(tx, appt.id, appt.scheduleSlotId);
      }

      const { updated, rawToken } = await this.confirmations.confirmSingleAppointment(tx, appt.id, assignedQueueNumber, 'HOLD', 'PAYMENT_SUCCESS', bookingOrderId);
      snapshots.push(updated);
      confirmedAppointments.push({ appointmentId: updated.id, bookingCode: updated.bookingCode, queueNumber: assignedQueueNumber });
      if (appointments.length === 1) singleConfirmation = { bookingCode: updated.bookingCode, queueNumber: assignedQueueNumber, qrToken: rawToken };
    }

    return { status: PaymentStatus.SUCCESS, appointmentStatus: 'CONFIRMED', bookingOrderId, appointments: confirmedAppointments, ...singleConfirmation };
  }
}
