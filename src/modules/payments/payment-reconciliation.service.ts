import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { BookingService } from '../bookings/booking.service.js';
import { PaymentService } from './payment.service.js';

@Injectable()
export class PaymentReconciliationService {
  private readonly logger = new Logger(PaymentReconciliationService.name);
  private running = false;
  private cursor: string | undefined;
  private readonly inFlight = new Map<string, Promise<any>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentService,
    private readonly bookings: BookingService,
    private readonly config: ConfigService,
  ) {}

  private enabled(): boolean {
    return this.config.get<string>('PAYOS_RECONCILIATION_ENABLED') !== 'false'
      && ['PAYOS_CLIENT_ID', 'PAYOS_API_KEY', 'PAYOS_CHECKSUM_KEY'].every(key => Boolean(this.config.get<string>(key)?.trim()));
  }

  private sync(paymentId: string): Promise<any> {
    const existing = this.inFlight.get(paymentId);
    if (existing) return existing;
    const request = this.payments.syncPayosPaymentStatus(paymentId)
      .finally(() => this.inFlight.delete(paymentId));
    this.inFlight.set(paymentId, request);
    return request;
  }

  // Runs independently of mobile/web and RabbitMQ connectivity.
  @Interval(10_000)
  async reconcilePendingPayments(): Promise<void> {
    if (!this.enabled() || this.running) return;
    this.running = true;
    try {
      const rows = await this.prisma.paymentTransaction.findMany({
        where: {
          provider: 'PAYOS',
          providerTransactionId: { not: null },
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          invoice: { status: 'UNPAID' },
          OR: [
            { status: 'PENDING' },
            // Recover old timeout cancellations, never manually cancelled bookings.
            { status: 'FAILED', invoice: { appointment: {
              status: 'CANCELLED', statusHistories: { some: { reason: 'PAYMENT_HOLD_TIMEOUT' } },
            } } },
          ],
        },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: 20,
        ...(this.cursor ? { cursor: { id: this.cursor }, skip: 1 } : {}),
      });
      // Rotate through all candidates rather than repeatedly querying the same first page.
      this.cursor = rows.length === 20 ? rows[rows.length - 1].id : undefined;
      for (let index = 0; index < rows.length; index += 2) {
        const results = await Promise.allSettled(rows.slice(index, index + 2).map(row => this.sync(row.id)));
        for (const result of results) {
          if (result.status === 'rejected') this.logger.warn('Không đồng bộ được giao dịch PayOS; sẽ thử lại ở chu kỳ sau.');
        }
      }
    } catch {
      this.logger.warn('Không tải được danh sách đối soát PayOS; sẽ thử lại ở chu kỳ sau.');
    } finally {
      this.running = false;
    }
  }

  /** Verify with the provider before releasing a potentially paid reservation. */
  async expireHoldIfUnpaid(appointmentId: string): Promise<boolean> {
    const payment = await this.prisma.paymentTransaction.findFirst({
      where: {
        provider: 'PAYOS',
        invoice: { OR: [
          { appointmentId },
          { bookingOrder: { appointments: { some: { id: appointmentId } } } },
        ] },
      },
      select: { id: true, status: true, invoice: { select: { status: true } } },
      orderBy: { createdAt: 'desc' },
    });
    if (payment) {
      if (payment.status === 'SUCCESS' || payment.invoice.status === 'PAID') return false;
      if (!this.enabled()) return false;
      try {
        const result = await this.sync(payment.id);
        // An unavailable gateway is not evidence of a failed payment.
        if (!result || !['PENDING', 'CANCELLED', 'EXPIRED'].includes(result.status)) return false;
      } catch {
        return false;
      }
    }
    return this.bookings.expireHold(appointmentId);
  }
}
