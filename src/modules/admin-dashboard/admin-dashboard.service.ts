import { ForbiddenException, Injectable } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js'

type StatusCounts = {
  total: number
  pending: number
  confirmed: number
  examined: number
  cancelled: number
  booked: number
  checkedIn: number
  inExamination: number
  pendingPayment: number
}

@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  private dateKey(value: Date) {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  private rangeScope(baseScope: Record<string, unknown>, from: Date, to: Date) {
    return {
      AND: [
        baseScope,
        {
          OR: [
            { scheduleSlot: { schedule: { workDate: { gte: from, lt: to } } } },
            { servicePackageScheduleSlot: { schedule: { examDate: { gte: from, lt: to } } } },
          ],
        },
      ],
    }
  }

  private async statusCounts(where: Record<string, unknown>): Promise<StatusCounts> {
    const rows = await this.prisma.appointment.groupBy({
      by: ['status'],
      where: where as any,
      _count: { _all: true },
    })
    const count = (status: string) => rows.find((row) => row.status === status)?._count._all || 0
    const pendingPayment = count('PENDING_PAYMENT')
    const booked = count('BOOKED')
    const checkedIn = count('CHECKED_IN')
    const inExamination = count('IN_EXAMINATION')
    const examined = count('COMPLETED')
    const cancelled = count('CANCELLED')
    return {
      total: pendingPayment + booked + checkedIn + inExamination + examined + cancelled,
      pending: pendingPayment + booked,
      confirmed: checkedIn + inExamination,
      examined,
      cancelled,
      booked,
      checkedIn,
      inExamination,
      pendingPayment,
    }
  }

  async overview(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        branchAssignments: { select: { branchId: true } },
        doctor: { select: { id: true } },
      },
    })
    if (!user || user.role === 'PATIENT') throw new ForbiddenException('Chỉ nhân viên được xem dashboard')

    const branchIds = user.branchAssignments.map((item) => item.branchId)
    const appointmentScope: Record<string, unknown> = {}
    if (user.role === 'DOCTOR') appointmentScope.doctorId = user.doctor?.id || '__none__'
    else if (user.role !== 'ADMIN') appointmentScope.branchId = { in: branchIds.length ? branchIds : ['__none__'] }

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const tomorrow = new Date(todayStart)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const weekStart = new Date(todayStart)
    const dayOfWeek = weekStart.getDay() || 7
    weekStart.setDate(weekStart.getDate() - dayOfWeek + 1)
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 7)

    const todayScope = this.rangeScope(appointmentScope, todayStart, tomorrow)
    const weekScope = this.rangeScope(appointmentScope, weekStart, weekEnd)
    const [today, week, todayRows, paidInvoices] = await Promise.all([
      this.statusCounts(todayScope),
      this.statusCounts(weekScope),
      this.prisma.appointment.findMany({
        where: todayScope as any,
        select: {
          id: true,
          bookingCode: true,
          status: true,
          queueNumber: true,
          patientProfile: { select: { fullName: true } },
          scheduleSlot: { select: { startTime: true, schedule: { select: { room: { select: { id: true, name: true, code: true } } } } } },
          servicePackageScheduleSlot: { select: { startTime: true, schedule: { select: { room: { select: { id: true, name: true, code: true } } } } } },
          statusHistories: { orderBy: { createdAt: 'asc' }, take: 1, select: { actor: { select: { role: true } } } },
          invoice: { select: { status: true } },
        },
      }),
      this.prisma.invoice.findMany({
        where: { appointment: todayScope as any, status: 'PAID' },
        select: { totalAmount: true, payments: { where: { status: 'SUCCESS' }, orderBy: { paidAt: 'desc' }, take: 1, select: { method: true } } },
      }),
    ])

    const sourcesToday = { clinic: 0, online: 0, other: 0 }
    const roomMap = new Map<string, { room: string; total: number; pending: number; confirmed: number }>()
    for (const appointment of todayRows) {
      const actorRole = appointment.statusHistories[0]?.actor?.role
      if (actorRole === 'PATIENT' || !actorRole) sourcesToday.online += 1
      else sourcesToday.clinic += 1
      const room = appointment.servicePackageScheduleSlot?.schedule.room ?? appointment.scheduleSlot?.schedule.room
      if (room) {
        const current = roomMap.get(room.id) || { room: room.name || room.code, total: 0, pending: 0, confirmed: 0 }
        current.total += 1
        if (['PENDING_PAYMENT', 'BOOKED'].includes(appointment.status)) current.pending += 1
        if (['CHECKED_IN', 'IN_EXAMINATION'].includes(appointment.status)) current.confirmed += 1
        roomMap.set(room.id, current)
      }
    }

    const revenueToday = paidInvoices.reduce(
      (result, invoice) => {
        const amount = Number(invoice.totalAmount)
        result.total += amount
        result.count += 1
        const method = String(invoice.payments[0]?.method || '').toUpperCase()
        if (method === 'CASH') result.cash += amount
        else result.transfer += amount
        return result
      },
      { total: 0, count: 0, cash: 0, transfer: 0 },
    )

    const unpaidPending = todayRows.filter((row) => row.status === 'PENDING_PAYMENT' && row.invoice?.status !== 'PAID').length
    const bookedWaitingCheckIn = todayRows.filter((row) => row.status === 'BOOKED').length
    return {
      today: this.dateKey(todayStart),
      week: { from: this.dateKey(weekStart), to: this.dateKey(new Date(weekEnd.getTime() - 1)) },
      appointments: { today, week },
      sourcesToday,
      revenueToday,
      byRoomToday: [...roomMap.values()],
      todayActions: {
        pendingTotal: today.pending,
        unpaidPending,
        pendingNoRoom: 0,
        readyToConfirm: bookedWaitingCheckIn,
        expiringSoon: 0,
        alerts: [],
      },
      totalAppointments: today.total,
    }
  }
}
