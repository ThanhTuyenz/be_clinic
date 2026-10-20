import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { getStaffUser } from '../../common/utils/staff.utils.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';

@Injectable()
export class CounterPaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  async recordPayment(userId: string, appointmentId: string, input: { method?: string; amount?: number; note?: string }) {
    const user = await getStaffUser(this.prisma, userId)
    const role = user.role
    if (!['CHAIN_MANAGER', 'BRANCH_MANAGER', 'RECEPTIONIST'].includes(role)) {
      throw new ForbiddenException('Không có quyền ghi nhận thanh toán')
    }
    const invoice = await this.prisma.invoice.findUnique({
      where: { appointmentId },
      include: { appointment: true, payments: { where: { status: 'SUCCESS' }, take: 1 } },
    })
    if (!invoice) throw new NotFoundException('Không tìm thấy hóa đơn của lịch khám')
    if (user.role !== 'CHAIN_MANAGER' && !user.branchAssignments.some(link => link.branchId === invoice.issuedBranchId)) throw new ForbiddenException('Chỉ được thu tiền tại chi nhánh phụ trách')
    if (!invoice.appointment || !['HOLD', 'CONFIRMED'].includes(invoice.appointment.status)) throw new BadRequestException('Lịch khám không ở trạng thái có thể thanh toán')
    if (invoice.status === 'PAID' || invoice.payments.length) throw new BadRequestException('Lịch khám đã được thanh toán')
    const amount = Number(input.amount ?? invoice.totalAmount)
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Số tiền không hợp lệ')
    const m = String(input.method || 'cash').toLowerCase()
    const method = m === 'cash' ? 'CASH' : m === 'card' ? 'POS_CARD' : (m === 'payos' || m === 'online') ? 'ONLINE' : 'VIETQR'
    const now = new Date()
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.invoice.updateMany({
        where: { id: invoice.id, status: 'UNPAID', paidAt: null },
        data: { status: 'PAID', paidAt: now },
      })
      if (claimed.count !== 1) throw new ConflictException('Hóa đơn vừa được thanh toán hoặc hủy, vui lòng tải lại')
      if (invoice.appointment.status === 'HOLD') {
        const confirmed = await tx.appointment.updateMany({
          where: { id: appointmentId, status: 'HOLD' }, data: { status: 'CONFIRMED', holdExpiresAt: null },
        })
        if (confirmed.count !== 1) throw new ConflictException('Lịch khám vừa được cập nhật, vui lòng tải lại')
        await tx.appointmentStatusHistory.create({ data: {
          appointmentId, fromStatus: 'HOLD', toStatus: 'CONFIRMED', actorId: userId, reason: 'COUNTER_PAYMENT_SUCCESS',
        } })
      }
      const payment = await tx.paymentTransaction.create({
        data: {
          invoiceId: invoice.id,
          provider: 'CLINIC_COUNTER',
          idempotencyKey: `counter-${appointmentId}-${randomUUID()}`,
          method,
          amount,
          status: 'SUCCESS',
          paidAt: now,
          rawPayload: { note: input.note || null, recordedBy: userId, channel: input.method },
        },
      })
      const appointment = await tx.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
      return { appointment, payment }
    })
  }
}
