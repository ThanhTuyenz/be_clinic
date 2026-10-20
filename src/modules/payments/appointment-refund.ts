import { Prisma } from '@prisma/client';

export interface AppointmentRefundInput {
  appointmentId: string; bookingOrderId?: string | null; bookingCode?: string | null;
  reason: string; isUrgent?: boolean; isClinicCancelled?: boolean;
  refundBank?: { bankCode?: string; bankName?: string; bankBin?: string; accountNumber?: string; accountName?: string };
}

/** Records a refund request, never claims that money has already been refunded. */
export async function requestAppointmentRefund(tx: Prisma.TransactionClient, input: AppointmentRefundInput) {
  const invoice = await tx.invoice.findFirst({
    where: {
      OR: [
        { appointmentId: input.appointmentId },
        ...(input.bookingOrderId ? [{ bookingOrderId: input.bookingOrderId }] : []),
      ]
    },
    select: {
      id: true, bookingOrderId: true,
      bookingOrder: { select: { _count: { select: { appointments: true } } } },
      payments: {
        where: { status: { in: ['SUCCESS', 'REFUND_REQUIRED'] } }, orderBy: { createdAt: 'desc' }, take: 1,
        select: { id: true, amount: true, rawPayload: true }
      },
    },
  });
  const payment = invoice?.payments[0];
  if (!payment) return false;
  const raw = payment.rawPayload && typeof payment.rawPayload === 'object' && !Array.isArray(payment.rawPayload)
    ? payment.rawPayload as Record<string, Prisma.JsonValue> : {};
  const requests = raw.appointmentRefunds && typeof raw.appointmentRefunds === 'object' && !Array.isArray(raw.appointmentRefunds)
    ? raw.appointmentRefunds as Record<string, Prisma.JsonValue> : {};
  if (requests[input.appointmentId]) return true;
  const requestedAt = new Date().toISOString();
  const grouped = (invoice.bookingOrder?._count.appointments || 0) > 1;
  await tx.paymentTransaction.update({
    where: { id: payment.id },
    data: {
      status: 'REFUND_REQUIRED', rawPayload: {
        ...raw,
        ...(input.refundBank ? { refundBank: input.refundBank, refundRequestedAt: requestedAt } : {}),
        appointmentRefunds: { ...requests, [input.appointmentId]: { requestedAt, reason: input.reason } },
      } as Prisma.InputJsonValue
    },
  });
  await tx.outboxEvent.create({
    data: {
      aggregateType: 'PaymentTransaction', aggregateId: payment.id, eventType: 'payment.refund.required',
      payload: {
        appointmentId: input.appointmentId, reason: input.reason,
        paymentId: payment.id, bookingOrderId: invoice.bookingOrderId,
        ...(input.bookingCode ? { bookingCode: input.bookingCode } : {}),
        ...(input.isUrgent !== undefined ? { isUrgent: input.isUrgent } : {}),
        ...(input.isClinicCancelled !== undefined ? { isClinicCancelled: input.isClinicCancelled } : {}),
        ...(input.refundBank ? { refundBank: input.refundBank } : {}),
        // One member cancelling must not request a refund of the entire family payment.
        ...(grouped ? { requiresManualReview: true } : { amount: Number(payment.amount) }),
      } as Prisma.InputJsonValue,
    }
  });
  return true;
}
