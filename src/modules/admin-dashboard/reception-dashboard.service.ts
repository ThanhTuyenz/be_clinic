import { ForbiddenException, Injectable } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js'

export type ReceptionSummaryDto = {
  date: string
  appointments: {
    total: number
    pending: number
    confirmed: number
    examined: number
    cancelled: number
    hold: number
    checkedIn: number
  }
  revenueToday: {
    total: number
    count: number
    cash: number
    transfer: number
    online: number
    onlineCount: number
  }
  sourcesToday: {
    clinic: number
    online: number
    other: number
  }
  patientsTotal: number
  todayActions: {
    unpaidPending: number
    bookedWaitingCheckIn: number
  }
}

export type RoomStatusItem = {
  id: string
  code: string
  room: string
  doctorName?: string
  specialty?: string
  total: number
  pending: number
  confirmed: number
  examined: number
  hasScheduleToday: boolean
}

@Injectable()
export class ReceptionDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  private parseDateRange(dateStr?: string) {
    let year: number, month: number, date: number
    if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const [y, m, d] = dateStr.split('-').map(Number)
      year = y
      month = m - 1
      date = d
    } else {
      const now = new Date()
      year = now.getFullYear()
      month = now.getMonth()
      date = now.getDate()
    }
    const from = new Date(Date.UTC(year, month, date, 0, 0, 0, 0))
    const to = new Date(Date.UTC(year, month, date + 1, 0, 0, 0, 0))
    const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}`
    return { from, to, dateKey }
  }

  private async getStaffUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        branchAssignments: { select: { branchId: true } },
      },
    })
    if (!user || user.role === 'PATIENT') {
      throw new ForbiddenException('Chỉ nhân viên phòng khám mới có quyền truy cập tiếp đón')
    }
    return user
  }

  private resolveBranchId(user: any, requestedBranchId?: string): string | undefined {
    const branchIds = user.branchAssignments.map((b: any) => b.branchId)
    if (user.role === 'ADMIN') {
      return requestedBranchId && requestedBranchId !== 'all' ? requestedBranchId : undefined
    }
    if (requestedBranchId && requestedBranchId !== 'all' && branchIds.includes(requestedBranchId)) {
      return requestedBranchId
    }
    return branchIds[0] || undefined
  }

  // 1. GET /reception/summary
  async getSummary(userId: string, query?: { date?: string; branchId?: string }): Promise<ReceptionSummaryDto> {
    const user = await this.getStaffUser(userId)
    const branchId = this.resolveBranchId(user, query?.branchId)
    const { from, to, dateKey } = this.parseDateRange(query?.date)

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
        this.prisma.patientProfile.count(),
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

    // Tính trạng thái ca khám
    const countStatus = (st: string) => statusRows.find((r) => r.status === st)?._count._all || 0
    const hold = countStatus('HOLD')
    const confirmed = countStatus('CONFIRMED')
    const checkedIn = countStatus('CHECKED_IN')
    const examined = countStatus('COMPLETED')
    const cancelled = countStatus('CANCELLED')
    const noShow = countStatus('NO_SHOW')

    // Tính doanh thu quầy thu ngân (Tiền mặt vs CK tại quầy vs Trả trước Online)
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

    // Tính nguồn đặt khám
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

  // 2. GET /reception/rooms-status
  async getRoomsStatus(userId: string, query?: { date?: string; branchId?: string }): Promise<{ date: string; rooms: RoomStatusItem[] }> {
    const user = await this.getStaffUser(userId)
    const branchId = this.resolveBranchId(user, query?.branchId)
    const { from, to, dateKey } = this.parseDateRange(query?.date)

    const [allClinicRooms, todayRoomAppointments] = await Promise.all([
      this.prisma.clinicRoom.findMany({
        where: {
          isActive: true,
          ...(branchId ? { branchId } : {}),
        },
        select: {
          id: true,
          code: true,
          name: true,
          specialties: {
            where: { isActive: true },
            select: { specialty: { select: { name: true } } },
            take: 1,
          },
          schedules: {
            where: {
              workDate: { gte: from, lt: to },
              status: 'OPEN',
            },
            select: {
              doctor: {
                select: {
                  academicRank: true,
                  user: { select: { fullName: true } },
                },
              },
            },
            take: 1,
          },
        },
        orderBy: { code: 'asc' },
      }),
      this.prisma.appointment.findMany({
        where: {
          scheduleSlot: {
            schedule: {
              workDate: { gte: from, lt: to },
              ...(branchId ? { branchId } : {}),
            },
          },
          status: { in: ['HOLD', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED'] },
        },
        select: {
          status: true,
          scheduleSlot: {
            select: {
              schedule: {
                select: { roomId: true },
              },
            },
          },
        },
      }),
    ])

    const roomApptMap = new Map<string, { total: number; pending: number; confirmed: number; examined: number }>()
    for (const appt of (todayRoomAppointments as any[]) || []) {
      const rId = appt.scheduleSlot?.schedule?.roomId
      if (!rId) continue
      let item = roomApptMap.get(rId)
      if (!item) {
        item = { total: 0, pending: 0, confirmed: 0, examined: 0 }
        roomApptMap.set(rId, item)
      }
      item.total += 1
      if (appt.status === 'HOLD') item.pending += 1
      else if (appt.status === 'CONFIRMED' || appt.status === 'CHECKED_IN') item.confirmed += 1
      else if (appt.status === 'COMPLETED') item.examined += 1
    }

    const rooms: RoomStatusItem[] = allClinicRooms.map((r) => {
      const doc = r.schedules[0]?.doctor
      const doctorName = doc
        ? `${doc.academicRank ? doc.academicRank + ' ' : ''}${doc.user?.fullName || ''}`.trim()
        : ''
      const specialty = r.specialties[0]?.specialty?.name || ''
      const counts = roomApptMap.get(r.id) || { total: 0, pending: 0, confirmed: 0, examined: 0 }

      return {
        id: r.id,
        code: r.code,
        room: r.name || r.code,
        doctorName: doctorName || undefined,
        specialty: specialty || undefined,
        total: counts.total,
        pending: counts.pending,
        confirmed: counts.confirmed,
        examined: counts.examined,
        hasScheduleToday: r.schedules.length > 0,
      }
    })

    return { date: dateKey, rooms }
  }

  // 3. GET /reception/upcoming
  async getUpcoming(userId: string, query?: { date?: string; branchId?: string; limit?: number }) {
    const user = await this.getStaffUser(userId)
    const branchId = this.resolveBranchId(user, query?.branchId)
    const { from, to, dateKey } = this.parseDateRange(query?.date)
    const limit = Math.min(Math.max(Number(query?.limit) || 5, 1), 20)

    const items = await this.prisma.appointment.findMany({
      where: {
        scheduleSlot: {
          schedule: {
            workDate: { gte: from, lt: to },
            ...(branchId ? { branchId } : {}),
          },
        },
        status: { in: ['HOLD', 'CONFIRMED'] },
      },
      select: {
        id: true,
        bookingCode: true,
        status: true,
        queueNumber: true,
        createdAt: true,
        patientProfile: {
          select: {
            id: true,
            fullName: true,
            phoneNumber: true,
          },
        },
        scheduleSlot: {
          select: {
            startTime: true,
            endTime: true,
            schedule: {
              select: {
                room: { select: { id: true, name: true, code: true } },
                doctor: { select: { user: { select: { fullName: true } } } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    })

    return {
      date: dateKey,
      count: items.length,
      items,
    }
  }
}
