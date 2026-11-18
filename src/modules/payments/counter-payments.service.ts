import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { getStaffUser } from '../../common/utils/staff.utils.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { MyCollectionsQueryDto } from './dtos/my-collections-query.dto.js';
import { AppointmentConfirmationService, ConfirmedAppointment } from '../appointments/appointment-confirmation.service.js';
import { computeQueueNumber } from '../appointments/helpers/appointment.helper.js';

@Injectable()
export class CounterPaymentsService {
  constructor(private readonly prisma: PrismaService, private readonly confirmations: AppointmentConfirmationService) {}

  async myCollections(userId: string, query: MyCollectionsQueryDto) {
    const user = await getStaffUser(this.prisma, userId);
    if (!['BRANCH_MANAGER', 'RECEPTIONIST'].includes(user.role)) {
      throw new ForbiddenException('Không có quyền xem lịch sử thu tiền tại quầy');
    }
    const branchIds = user.branchId ? [user.branchId] : [];
    if (!branchIds.length) throw new ForbiddenException('Tài khoản chưa được phân công chi nhánh');
    const date = query.date || new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const from = new Date(`${date}T00:00:00+07:00`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(from.getTime()) ||
        new Date(from.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10) !== date) {
      throw new BadRequestException('Ngày thu tiền không hợp lệ');
    }
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const where: Prisma.PaymentTransactionWhereInput = {
      provider: 'CLINIC_COUNTER',
      status: 'SUCCESS',
      method: { in: ['CASH', 'VIETQR'] },
      rawPayload: { path: ['recordedBy'], equals: userId },
      paidAt: { gte: from, lt: new Date(from.getTime() + 24 * 60 * 60 * 1000) },
      invoice: { issuedBranchId: { in: branchIds } },
    };
    const { items, groups } = await this.prisma.$transaction(async tx => {
      const items = await tx.paymentTransaction.findMany({
        where, orderBy: [{ paidAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize,
        select: {
          id: true, amount: true, method: true, paidAt: true,
          invoice: { select: {
            id: true, issuedBranch: { select: { id: true, name: true } },
            bookingOrder: { select: { id: true, orderCode: true, appointments: { orderBy: { createdAt: 'asc' }, select: {
              bookingCode: true, patientProfile: { select: { fullName: true, phoneNumber: true } },
            } } } },
          } },
        },
      });
      const groups = await tx.paymentTransaction.groupBy({
        by: ['method'], where, _sum: { amount: true }, _count: { _all: true },
      });
      return { items, groups };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const total = groups.reduce((sum, group) => sum + group._count._all, 0);
    const totalAmount = groups.reduce((sum, group) => sum + Number(group._sum.amount || 0), 0);
    const cashAmount = Number(groups.find(group => group.method === 'CASH')?._sum.amount || 0);
    return {
      date, page, pageSize, total, totalAmount, cashAmount, transferAmount: totalAmount - cashAmount,
      items: items.map(item => ({
        id: item.id, amount: Number(item.amount), method: item.method, paidAt: item.paidAt,
        invoiceId: item.invoice.id, bookingOrderId: item.invoice.bookingOrder.id,
        ticket: item.invoice.bookingOrder.appointments.length === 1 ? item.invoice.bookingOrder.appointments[0].bookingCode : item.invoice.bookingOrder.orderCode,
        patientName: item.invoice.bookingOrder.appointments.map(appointment => appointment.patientProfile.fullName).join(', '),
        patientPhone: item.invoice.bookingOrder.appointments[0]?.patientProfile.phoneNumber ?? null,
        branch: item.invoice.issuedBranch,
      })),
    };
  }

  async recordPayment(userId: string, appointmentId: string, input: { method?: string; amount?: number; note?: string }) {
    const user = await getStaffUser(this.prisma, userId)
    const role = user.role
    if (!['CHAIN_MANAGER', 'BRANCH_MANAGER', 'RECEPTIONIST'].includes(role)) {
      throw new ForbiddenException('Không có quyền ghi nhận thanh toán')
    }
    const m = String(input.method || 'cash').toLowerCase()
    const method = m === 'cash' ? 'CASH' : m === 'card' ? 'POS_CARD' : (m === 'payos' || m === 'online') ? 'ONLINE' : 'VIETQR'
    const now = new Date()
    const snapshots: ConfirmedAppointment[] = []
    const result = await this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { bookingOrder: { appointments: { some: { id: appointmentId } } } },
        include: { bookingOrder: { include: { appointments: { orderBy: { id: 'asc' } } } }, payments: { where: { status: 'SUCCESS' }, take: 1 } },
      })
      if (!invoice) throw new NotFoundException('Không tìm thấy hóa đơn của lịch khám')
      if (role !== 'CHAIN_MANAGER' && user.branchId !== invoice.issuedBranchId) throw new ForbiddenException('Chỉ được thu tiền tại chi nhánh phụ trách')
      if (!invoice.bookingOrder.appointments.length || invoice.bookingOrder.appointments.some(appointment => !['HOLD', 'CONFIRMED'].includes(appointment.status))) throw new BadRequestException('Đơn có lịch khám không ở trạng thái có thể thanh toán')
      if (invoice.status === 'PAID' || invoice.payments.length) throw new BadRequestException('Đơn đặt lịch đã được thanh toán')
      if (!['UNPAID', 'PENDING_PAYMENT'].includes(invoice.bookingOrder.status)) throw new BadRequestException('Đơn đặt lịch không ở trạng thái chờ thanh toán')
      const amount = Number(input.amount ?? invoice.totalAmount)
      if (!Number.isFinite(amount) || amount <= 0 || amount !== Number(invoice.totalAmount)) throw new BadRequestException('Số tiền thu phải bằng tổng tiền hóa đơn của đơn đặt lịch')
      const claimed = await tx.invoice.updateMany({
        where: { id: invoice.id, status: 'UNPAID', paidAt: null },
        data: { status: 'PAID', paidAt: now },
      })
      if (claimed.count !== 1) throw new ConflictException('Hóa đơn vừa được thanh toán hoặc hủy, vui lòng tải lại')
      await tx.bookingOrder.update({ where: { id: invoice.bookingOrderId }, data: { status: 'PAID' } })
      for (const appointment of invoice.bookingOrder.appointments) {
        if (appointment.status !== 'HOLD') continue
        const queueNumber = appointment.receptionSlotId ? null : appointment.queueNumber ?? await computeQueueNumber(tx, appointment.id, appointment.scheduleSlotId)
        const { updated } = await this.confirmations.confirmSingleAppointment(tx, appointment.id, queueNumber, 'HOLD', 'COUNTER_PAYMENT_SUCCESS', invoice.bookingOrderId)
        snapshots.push(updated)
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
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    for (const snapshot of snapshots) await this.confirmations.notifyConfirmedAppointment(snapshot)
    return result
  }
}
