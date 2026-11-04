import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { PaymentService } from '../payments/payment.service.js';

const invoiceSelect = {
  totalAmount: true, status: true, payments: {
    orderBy: { createdAt: 'desc' as const },
    select: { id: true, status: true, amount: true, provider: true, providerTransactionId: true, rawPayload: true },
  },
} satisfies Prisma.InvoiceSelect;
const select = {
  id: true, bookingCode: true, status: true, holdExpiresAt: true, bookingOrderId: true,
  invoice: { select: invoiceSelect }, bookingOrder: { select: { invoice: { select: invoiceSelect } } },
  statusHistories: { where: { toStatus: 'CANCELLED' as const }, orderBy: { createdAt: 'desc' as const }, take: 1, select: { reason: true } },
} satisfies Prisma.AppointmentSelect;

const PAYMENT_LABELS = {
  PAID: 'Đã thanh toán', PENDING: 'Chờ thanh toán', UNPAID: 'Chưa thanh toán',
  CANCELLED: 'Đã hủy', EXPIRED: 'Đã hết hạn', FAILED: 'Thanh toán chưa thành công',
  MANUAL_REVIEW: 'Giao dịch đang chờ kiểm tra',
  REFUND_REQUIRED: 'Yêu cầu hoàn tiền đang chờ xử lý', REFUNDED: 'Đã hoàn tiền',
  AWAITING_RECONCILIATION: 'Đã hết thời gian giữ chỗ, hệ thống đang đối soát thanh toán',
} as const;
export interface AiPaymentStatusResult {
  appointmentId: string; bookingCode: string | null; appointmentStatus: string;
  status: keyof typeof PAYMENT_LABELS; label: string; invoiceTotal: number | null;
  paymentAmount: number | null; scope: 'APPOINTMENT' | 'BOOKING_ORDER';
  checkedAt: string; freshness: 'DATABASE' | 'GATEWAY_SYNCED' | 'GATEWAY_UNAVAILABLE';
}

@Injectable()
export class AiPaymentStatusService {
  constructor(private readonly prisma: PrismaService, private readonly payments: PaymentService) {}

  async lookup(userId: string, reference: string, refresh = true): Promise<AiPaymentStatusResult> {
    if (!userId) throw new UnauthorizedException('Vui lòng đăng nhập để kiểm tra thanh toán.');
    const value = reference?.trim();
    if (!value || value.length > 100) throw new BadRequestException('Vui lòng chọn lịch hẹn hoặc cung cấp mã lịch hẹn hợp lệ.');
    const where: Prisma.AppointmentWhereInput = {
      ...(isUUID(value) ? { id: value } : { bookingCode: { equals: value, mode: 'insensitive' } }),
      OR: [{ patientProfile: { accountId: userId } }, { bookingOrder: { accountId: userId } }],
    };
    const read = () => this.prisma.appointment.findFirst({ where, select });
    let row = await read();
    if (!row) throw new NotFoundException('Không tìm thấy lịch hẹn thuộc tài khoản của bạn.');
    let invoice = row.invoice ?? row.bookingOrder?.invoice;
    let freshness: AiPaymentStatusResult['freshness'] = 'DATABASE';
    const pending = invoice?.payments.find(payment => payment.provider === 'PAYOS'
      && payment.providerTransactionId && ['PENDING', 'FAILED'].includes(payment.status));
    // Ownership is established before contacting the gateway. Never create a link or move money here.
    if (refresh && pending && invoice?.status === 'UNPAID') {
      try {
        const sync = await this.payments.syncPayosPaymentStatus(pending.id, userId);
        freshness = sync?.success ? 'GATEWAY_SYNCED' : 'GATEWAY_UNAVAILABLE';
      } catch { freshness = 'GATEWAY_UNAVAILABLE'; }
      row = await read();
      if (!row) throw new NotFoundException('Không tìm thấy lịch hẹn thuộc tài khoản của bạn.');
      invoice = row.invoice ?? row.bookingOrder?.invoice;
    }
    const payments = invoice?.payments ?? [];
    const refund = payments.find(payment => {
      if (!['REFUND_REQUIRED', 'REFUNDED'].includes(payment.status)) return false;
      if (!row.bookingOrderId) return true;
      const payload = payment.rawPayload as Record<string, unknown> | null;
      const requests = payload?.appointmentRefunds;
      // One member requesting a refund must not label the whole family's appointments as refunded.
      return !requests || (typeof requests === 'object' && Object.hasOwn(requests, row.id));
    });
    let status: AiPaymentStatusResult['status'];
    if (refund) status = refund.status as 'REFUND_REQUIRED' | 'REFUNDED';
    else if (invoice?.status === 'REFUNDED') status = 'REFUNDED';
    else if (invoice?.status === 'PAID') status = 'PAID';
    else if (payments.some(payment => ['SUCCESS', 'LATE_SUCCESS', 'MANUAL_REVIEW'].includes(payment.status))) status = 'MANUAL_REVIEW';
    else if (row.status === 'CANCELLED') status = row.statusHistories[0]?.reason === 'PAYMENT_HOLD_TIMEOUT' ? 'EXPIRED' : 'CANCELLED';
    else if (invoice?.status === 'CANCELLED') status = 'CANCELLED';
    else if (row.status === 'HOLD' && row.holdExpiresAt && row.holdExpiresAt.getTime() <= Date.now()) status = 'AWAITING_RECONCILIATION';
    else if (payments.some(payment => payment.status === 'PENDING')) status = 'PENDING';
    else if (payments[0]?.status === 'FAILED') status = 'FAILED';
    else if (payments[0]?.status === 'EXPIRED') status = 'EXPIRED';
    else status = 'UNPAID';
    const payment = refund ?? payments.find(item => ['SUCCESS', 'REFUND_REQUIRED', 'REFUNDED', 'PENDING'].includes(item.status));
    return {
      appointmentId: row.id, bookingCode: row.bookingCode, appointmentStatus: row.status,
      status, label: PAYMENT_LABELS[status], invoiceTotal: invoice ? Number(invoice.totalAmount) : null,
      paymentAmount: payment ? Number(payment.amount) : null, scope: row.bookingOrderId ? 'BOOKING_ORDER' : 'APPOINTMENT',
      checkedAt: new Date().toISOString(), freshness,
    };
  }
}
