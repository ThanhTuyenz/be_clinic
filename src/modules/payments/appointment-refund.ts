import { Prisma } from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import { appointmentDateTime } from '../appointments/helpers/appointment.helper.js';
import { allocateAppointmentPayment } from './order-payment-allocation.js';

export interface AppointmentRefundInput {
  appointmentId: string; bookingOrderId?: string | null; bookingCode?: string | null;
  reason: string; isUrgent?: boolean; isClinicCancelled?: boolean; expectedRefundQuote?: string;
  cancelledAt?: Date;
  reconcileExisting?: boolean;
  refundBank?: { bankCode?: string; bankName?: string; bankBin?: string; accountNumber?: string; accountName?: string };
}

export interface AppointmentRefundQuote {
  isPaid: boolean;
  paidAmount: number | null;
  refundRate: number | null;
  refundAmount: number | null;
  retainedAmount: number | null;
  requiresManualReview: boolean;
  policyVersion: string;
  quoteKey: string;
}

async function refundContext(tx: Prisma.TransactionClient, input: AppointmentRefundInput) {
  return tx.invoice.findFirst({
    where: { bookingOrder: { appointments: { some: { id: input.appointmentId } } } },
    select: {
      id: true, bookingOrderId: true,
      bookingOrder: { select: { appointments: { orderBy: { id: 'asc' }, select: { id: true, servicePrice: true } } } },
      payments: {
        where: { status: { in: ['SUCCESS', 'REFUND_REQUIRED'] } }, orderBy: { createdAt: 'desc' }, take: 1,
        select: { id: true, amount: true, rawPayload: true }
      },
    },
  });
}

/** Allocate actual payment after discounts; cumulative rounding preserves family totals. */
export async function getAppointmentRefundQuote(tx: Prisma.TransactionClient, input: AppointmentRefundInput): Promise<AppointmentRefundQuote> {
  const invoice = await refundContext(tx, input);
  const payment = invoice?.payments[0];
  const appointment = await tx.appointment.findUniqueOrThrow({
    where: { id: input.appointmentId },
    select: { receptionSlot: { select: { date: true, startTime: true } }, scheduleSlot: { select: { startTime: true, schedule: { select: { workDate: true } } } } },
  });
  const slot = appointment.scheduleSlot;
  const reception = appointment.receptionSlot;
  const referenceTime = reception ? appointmentDateTime(reception.date, reception.startTime) : slot ? appointmentDateTime(slot.schedule.workDate, slot.startTime) : null;
  const hours = referenceTime ? (referenceTime.getTime() - (input.cancelledAt?.getTime() ?? Date.now())) / 3_600_000 : null;
  let rate: number | null = input.isClinicCancelled ? 100 : hours === null ? 0 : hours >= 24 ? 95 : hours >= 2 ? 80 : 0;
  let paidAmount: number | null = payment ? Number(payment.amount) : 0;
  const members = invoice?.bookingOrder?.appointments ?? [];
  if (payment) paidAmount = allocateAppointmentPayment(Number(payment.amount), input.appointmentId, members);
  if (!input.isClinicCancelled && paidAmount === null) rate = 0;
  const requiresManualReview = !!payment && rate !== 0 && (rate === null || paidAmount === null);
  const refundAmount = !payment || rate === 0 ? 0 : requiresManualReview ? null : Math.floor(paidAmount! * rate! / 100);
  const quote = {
    isPaid: !!payment, paidAmount, refundRate: payment ? rate : null, refundAmount,
    retainedAmount: paidAmount !== null && refundAmount !== null ? paidAmount - refundAmount : null,
    requiresManualReview, policyVersion: 'cancellation-95-80-0-v2',
  };
  return { ...quote, quoteKey: JSON.stringify([input.appointmentId, payment?.id ?? null, quote.policyVersion, paidAmount, quote.refundRate, refundAmount]) };
}

/** Records approval separately from the actual transfer of money. */
export async function requestAppointmentRefund(tx: Prisma.TransactionClient, input: AppointmentRefundInput) {
  const initial = await refundContext(tx, input);
  if (initial) {
    // Serialize JSON updates when different family members cancel concurrently.
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${initial.id}::uuid FOR UPDATE`;
  }
  const invoice = await refundContext(tx, input);
  const payment = invoice?.payments[0];
  const quote = await getAppointmentRefundQuote(tx, input);
  if (input.expectedRefundQuote !== undefined && input.expectedRefundQuote !== quote.quoteKey) {
    throw new ConflictException('Số tiền hoàn đã thay đổi. Vui lòng mở lại hộp thoại hủy lịch để kiểm tra và xác nhận.');
  }
  if (!payment || !invoice) return null;
  const raw = payment.rawPayload && typeof payment.rawPayload === 'object' && !Array.isArray(payment.rawPayload)
    ? payment.rawPayload as Record<string, Prisma.JsonValue> : {};
  const requests = raw.appointmentRefunds && typeof raw.appointmentRefunds === 'object' && !Array.isArray(raw.appointmentRefunds)
    ? raw.appointmentRefunds as Record<string, Prisma.JsonValue> : {};
  const existing = requests[input.appointmentId];
  if (existing && (!input.reconcileExisting || typeof existing !== 'object' || Array.isArray(existing)
      || ['APPROVED', 'NOT_ELIGIBLE'].includes(String(existing.approvalStatus)))) return quote;
  const requestedAt = input.cancelledAt?.toISOString() ?? new Date().toISOString();
  const request = {
    ...(existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}),
    ...quote, requestedAt, reason: input.reason,
    approvalStatus: quote.refundAmount === 0 ? 'NOT_ELIGIBLE' : quote.requiresManualReview ? 'PENDING_REVIEW' : 'APPROVED',
    approvedAt: quote.requiresManualReview ? null : requestedAt,
    approvedBy: quote.requiresManualReview ? null : 'SYSTEM',
    ...(input.reconcileExisting ? { reconciledAt: new Date().toISOString() } : {}),
    ...(input.refundBank && quote.refundAmount !== 0 ? { refundBank: input.refundBank } : {}),
  };
  const nextRequests = { ...requests, [input.appointmentId]: request };
  const otherRefundsPending = Object.values(nextRequests).some(value => value && typeof value === 'object' && !Array.isArray(value) && value.approvalStatus !== 'NOT_ELIGIBLE');
  await tx.paymentTransaction.update({
    where: { id: payment.id },
    data: {
      ...(quote.refundAmount !== 0 ? { status: 'REFUND_REQUIRED' as const }
        : input.reconcileExisting && !otherRefundsPending ? { status: 'SUCCESS' as const } : {}), rawPayload: {
        ...raw,
        ...(input.refundBank && quote.refundAmount !== 0 ? { refundBank: input.refundBank, refundRequestedAt: requestedAt } : {}),
        appointmentRefunds: nextRequests,
      } as Prisma.InputJsonValue
    },
  });
  await tx.outboxEvent.create({
    data: {
      aggregateType: 'PaymentTransaction', aggregateId: payment.id,
      eventType: input.reconcileExisting ? 'payment.refund.policy_applied' : quote.refundAmount === 0 ? 'payment.refund.not_eligible' : 'payment.refund.required',
      payload: {
        appointmentId: input.appointmentId, ...request, amount: quote.refundAmount,
        paymentId: payment.id, bookingOrderId: invoice.bookingOrderId,
        ...(input.bookingCode ? { bookingCode: input.bookingCode } : {}),
        ...(input.isUrgent !== undefined ? { isUrgent: input.isUrgent } : {}),
        ...(input.isClinicCancelled !== undefined ? { isClinicCancelled: input.isClinicCancelled } : {}),
      } as Prisma.InputJsonValue,
    }
  });
  return quote;
}
