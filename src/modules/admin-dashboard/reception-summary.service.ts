import { ForbiddenException, Injectable } from '@nestjs/common';
import { getStaffUser, parseDateRange } from '../../common/utils/staff.utils.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';

@Injectable()
export class ReceptionSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async getReceptionSummary(userId: string, query?: { date?: string; branchId?: string }) {
    const user = await getStaffUser(this.prisma, userId)
    if (!['CHAIN_MANAGER', 'BRANCH_MANAGER', 'RECEPTIONIST'].includes(user.role)) throw new ForbiddenException('Không có quyền xem thống kê tiếp nhận')
    const requestedBranchId = query?.branchId?.trim()
    const assignedBranchIds = user.branchAssignments.map(link => link.branchId)
    let branchId: string | undefined
    if (user.role === 'CHAIN_MANAGER') {
      branchId = requestedBranchId && requestedBranchId !== 'all' ? requestedBranchId : undefined
    } else {
      if (!assignedBranchIds.length) throw new ForbiddenException('Tài khoản chưa được phân công chi nhánh')
      if (requestedBranchId && requestedBranchId !== 'all' && !assignedBranchIds.includes(requestedBranchId)) throw new ForbiddenException('Không có quyền xem thống kê chi nhánh này')
      branchId = requestedBranchId && requestedBranchId !== 'all' ? requestedBranchId : assignedBranchIds[0]
    }
    const { from, to, dateKey } = parseDateRange(query?.date)

    const appointmentWhere: any = {
      AND: [
        {
          OR: [
            { scheduleSlot: { schedule: { workDate: { gte: from, lt: to } } } },
            { checkedInAt: { gte: from, lt: to } },
            { createdAt: { gte: from, lt: to } },
          ],
        },
      ],
    }
    if (branchId) {
      appointmentWhere.AND.push({ branchId })
    }

    const invoiceWhere: any = {
      status: 'PAID',
      paidAt: { gte: from, lt: to },
      ...(branchId ? { issuedBranchId: branchId } : {}),
    }

    const [statusRows, invoices, todayAppointments, patientsTotal, unpaidPending, bookedWaitingCheckIn] =
      await Promise.all([
        this.prisma.appointment.groupBy({
          by: ['status'],
          where: appointmentWhere,
          _count: { _all: true },
        }),
        this.prisma.invoice.findMany({
          where: invoiceWhere,
          select: {
            totalAmount: true,
            payments: {
              where: { status: 'SUCCESS' },
              orderBy: { paidAt: 'desc' },
              take: 1,
              select: { method: true },
            },
          },
        }),
        this.prisma.appointment.findMany({
          where: appointmentWhere,
          select: {
            id: true,
            bookingOrderId: true,
            statusHistories: {
              orderBy: { createdAt: 'asc' },
              take: 1,
              select: { actor: { select: { role: true } } },
            },
          },
        }),
        this.prisma.patientProfile.count({ where: branchId ? { appointments: { some: { branchId } } } : {} }),
        this.prisma.appointment.count({
          where: {
            ...appointmentWhere,
            status: 'HOLD',
            invoice: { status: { not: 'PAID' } },
          },
        }),
        this.prisma.appointment.count({
          where: {
            ...appointmentWhere,
            status: 'CONFIRMED',
          },
        }),
      ])

    const countStatus = (st: string) => statusRows.find((r) => r.status === st)?._count._all || 0
    const hold = countStatus('HOLD')
    const confirmed = countStatus('CONFIRMED')
    const checkedIn = countStatus('CHECKED_IN')
    const examined = countStatus('COMPLETED')
    const cancelled = countStatus('CANCELLED')
    const noShow = countStatus('NO_SHOW')

    let cash = 0
    let transfer = 0
    let online = 0
    for (const inv of invoices) {
      const amt = Number(inv.totalAmount) || 0
      const method = String(inv.payments[0]?.method || '').toUpperCase()
      if (method === 'CASH') {
        cash += amt
      } else if (method === 'ONLINE') {
        online += amt
      } else {
        transfer += amt
      }
    }
    const counterTotal = cash + transfer
    const counterCount = invoices.filter(
      (inv) => String(inv.payments[0]?.method || '').toUpperCase() !== 'ONLINE',
    ).length
    const onlineCount = invoices.filter(
      (inv) => String(inv.payments[0]?.method || '').toUpperCase() === 'ONLINE',
    ).length

    const sourcesToday = { clinic: 0, online: 0, other: 0 }
    for (const appt of todayAppointments) {
      const actorRole = appt.statusHistories[0]?.actor?.role
      if (appt.bookingOrderId || actorRole === 'PATIENT' || !actorRole) {
        sourcesToday.online += 1
      } else {
        sourcesToday.clinic += 1
      }
    }

    return {
      date: dateKey,
      appointments: {
        total: hold + confirmed + checkedIn + examined + cancelled + noShow,
        pending: hold,
        confirmed: confirmed + checkedIn,
        examined,
        cancelled,
        hold,
        checkedIn,
      },
      revenueToday: {
        total: counterTotal,
        count: counterCount,
        cash,
        transfer,
        online,
        onlineCount,
      },
      sourcesToday,
      patientsTotal,
      todayActions: {
        unpaidPending,
        bookedWaitingCheckIn,
      },
    }
  }
}
