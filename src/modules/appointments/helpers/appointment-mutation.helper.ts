import { ConflictException } from '@nestjs/common';
import { AppointmentStatus, Prisma } from '@prisma/client';
import type { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import { releaseVoucherUsage } from '../../vouchers/vouchers.service.js';

export function appointmentTransaction<T>(prisma: PrismaService, execute: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(execute, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch((error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
      throw new ConflictException('Lịch hẹn vừa được cập nhật hoặc bị trùng. Vui lòng tải lại và thử lại.');
    }
    throw error;
  });
}

/** Called after a successful cancellation claim, within the same transaction. */
export async function releaseCancelledHoldVoucher(
  tx: Prisma.TransactionClient,
  appointment: { id: string; status: AppointmentStatus; bookingOrderId?: string | null },
  refundRequested: boolean,
) {
  if (appointment.status !== 'HOLD' || refundRequested) return;
  // Keep consumed vouchers for paid orders, including manually recorded payments.
  const paid = await tx.invoice.findFirst({
    where: { status: 'PAID', OR: [{ appointmentId: appointment.id }, ...(appointment.bookingOrderId ? [{ bookingOrderId: appointment.bookingOrderId }] : [])] },
    select: { id: true },
  });
  if (paid) return;
  if (appointment.bookingOrderId && await tx.appointment.count({
    where: { bookingOrderId: appointment.bookingOrderId, status: { not: 'CANCELLED' } },
  })) return;
  await releaseVoucherUsage(tx, appointment.bookingOrderId ? { bookingOrderId: appointment.bookingOrderId } : { appointmentId: appointment.id });
}
