import 'dotenv/config';
import dotenv from 'dotenv';
import { createHash, createHmac } from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PayOS } from '@payos/node';

dotenv.config({ path: process.env.ENV_FILE || '.env.development', override: true, quiet: true });
const appointmentId = process.argv.find(value => /^[0-9a-f-]{36}$/i.test(value));
if (!appointmentId) throw new Error('Usage: node scripts/reconcile-payos-payment.mjs <appointment UUID> [--apply]');
const apply = process.argv.includes('--apply');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL }) });
try {
  const payment = await prisma.paymentTransaction.findFirst({
    where: { provider: 'PAYOS', invoice: { appointmentId } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, providerTransactionId: true, amount: true, invoiceId: true },
  });
  if (!payment?.providerTransactionId || !/^\d+$/.test(payment.providerTransactionId)) throw new Error('No PayOS transaction found for this appointment');
  const gateway = new PayOS({ clientId: process.env.PAYOS_CLIENT_ID, apiKey: process.env.PAYOS_API_KEY, checksumKey: process.env.PAYOS_CHECKSUM_KEY });
  const receipt = await gateway.paymentRequests.get(Number(payment.providerTransactionId));
  if (receipt.status !== 'PAID' || Number(receipt.amountPaid) !== Number(payment.amount) || Number(receipt.amountRemaining) !== 0) {
    throw new Error('PayOS has not confirmed full payment; no data changed');
  }
  const paidAt = new Date(receipt.transactions?.[0]?.transactionDateTime || '');
  if (!Number.isFinite(paidAt.getTime())) throw new Error('PayOS receipt is missing a valid transaction time');
  const current = await prisma.appointment.findUniqueOrThrow({
    where: { id: appointmentId },
    select: { status: true, bookingCode: true, holdExpiresAt: true, invoice: { select: { status: true } },
      scheduleSlot: { select: { isActive: true, capacity: true, occupiedCount: true } } },
  });
  console.log(JSON.stringify({ apply, appointmentId, gatewayStatus: receipt.status, receivedAmount: receipt.amountPaid,
    paidAt, appointmentStatus: current.status, invoiceStatus: current.invoice?.status, bookingCode: current.bookingCode,
    slotAvailable: Boolean(current.scheduleSlot?.isActive && current.scheduleSlot.occupiedCount < current.scheduleSlot.capacity) }, null, 2));
  if (apply) {
    const result = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM payment_transactions WHERE id = ${payment.id}::uuid FOR UPDATE`;
      const latest = await tx.paymentTransaction.findUniqueOrThrow({
        where: { id: payment.id }, include: { invoice: { include: { appointment: {
          include: { scheduleSlot: { include: { schedule: true } }, statusHistories: { orderBy: { createdAt: 'desc' }, take: 1 } },
        } } } },
      });
      const appt = latest.invoice.appointment;
      if (!appt || appt.id !== appointmentId) throw new Error('Payment does not belong to this appointment');
      if (latest.status === 'SUCCESS' && latest.invoice.status === 'PAID') return { alreadyConfirmed: true, bookingCode: appt.bookingCode };
      if (!['PENDING', 'FAILED'].includes(latest.status) || latest.invoice.status !== 'UNPAID') throw new Error('Payment/invoice requires manual review');
      const demoAmount = Number(process.env.PAYOS_TEST_AMOUNT || 1000);
      if (Number(latest.amount) !== Number(latest.invoice.totalAmount) && Number(latest.amount) !== demoAmount) throw new Error('Payment amount differs from invoice and configured demo amount');
      if (appt.status !== 'HOLD') throw new Error('Only an active HOLD can be confirmed. Paid cancelled bookings require the backend refund flow; never reacquire capacity.');
      const secret = process.env.AUTH_JWT_SECRET;
      if (!secret) throw new Error('AUTH_JWT_SECRET is required to issue the appointment pass');
      let queueNumber = appt.queueNumber;
      if (queueNumber == null && appt.scheduleSlot) {
        const schedule = appt.scheduleSlot.schedule;
        const maximum = await tx.appointment.aggregate({
          where: { id: { not: appt.id }, branchId: appt.branchId,
            scheduleSlot: { schedule: { roomId: schedule.roomId, workDate: schedule.workDate } } },
          _max: { queueNumber: true },
        });
        queueNumber = (maximum._max.queueNumber || 0) + 1;
      }
      const bookingCode = appt.bookingCode || 'VC-' + appt.id.slice(0, 8).toUpperCase();
      const rawToken = createHmac('sha256', secret).update('check-in:' + appt.id).digest('base64url');
      const qrData = { tokenHash: createHash('sha256').update(rawToken).digest('hex'),
        expiresAt: new Date(Date.now() + 48 * 3600000), usedAt: null };
      await tx.paymentTransaction.update({ where: { id: latest.id }, data: {
        status: 'SUCCESS', paidAt, rawPayload: { ...(latest.rawPayload || {}), reconciliation: {
          source: 'PAYOS_API', orderCode: receipt.orderCode, amountPaid: receipt.amountPaid, paidAt: paidAt.toISOString(),
          reconciledAt: new Date().toISOString() } },
      } });
      await tx.invoice.update({ where: { id: latest.invoiceId }, data: { status: 'PAID', paidAt } });
      await tx.appointment.update({ where: { id: appt.id }, data: { status: 'CONFIRMED', bookingCode,
        queueNumber, holdExpiresAt: null, statusHistories: { create: {
          fromStatus: appt.status, toStatus: 'CONFIRMED', reason: 'PAYOS_RECONCILED_SUCCESS' },
        } } });
      await tx.appointmentQrToken.upsert({ where: { appointmentId: appt.id },
        update: qrData, create: { appointmentId: appt.id, ...qrData } });
      await tx.auditLog.create({ data: { action: 'PAYOS_PAYMENT_RECONCILED', targetType: 'Appointment',
        targetId: appt.id, metadata: { paymentId: latest.id, orderCode: receipt.orderCode,
          gatewayAmount: receipt.amountPaid, invoiceAmount: Number(latest.invoice.totalAmount), bookingCode,
          reason: 'Verified paid gateway receipt after local hold timeout', sendsNotifications: false } } });
      return { status: 'CONFIRMED', paymentStatus: 'SUCCESS', invoiceStatus: 'PAID', bookingCode };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    console.log(JSON.stringify(result, null, 2));
  }
} finally { await prisma.$disconnect(); }
