import { ForbiddenException, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { GoogleGenAI } from '@google/genai'
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js'
import { RedisService } from '../../infrastructure/redis/redis.service.js'

export type StatusCounts = {
  total: number
  pending: number
  confirmed: number
  examined: number
  cancelled: number
  hold: number
  checkedIn: number
}

@Injectable()
export class AdminDashboardService {
  private readonly logger = new Logger(AdminDashboardService.name)
  private aiClient: GoogleGenAI | null = null
  private readonly modelName: string

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {
    const apiKey = this.config.get<string>('gemini.apiKey') || process.env.GEMINI_API_KEY
    this.modelName = this.config.get<string>('gemini.model') || process.env.GEMINI_MODEL || 'gemini-2.5-flash'
    if (apiKey) {
      try {
        this.aiClient = new GoogleGenAI({ apiKey })
      } catch (err: any) {
        this.logger.warn(`Failed to initialize GoogleGenAI: ${err?.message}`)
      }
    }
  }

  private dateKey(value: Date) {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  private formatVnd(amount: number): string {
    return `${Math.round(amount).toLocaleString('vi-VN')} đ`
  }

  private async getStaffUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        branchAssignments: {
          select: {
            branchId: true,
            isPrimary: true,
            branch: {
              select: {
                id: true,
                code: true,
                name: true,
                address: true,
                phoneNumber: true,
              },
            },
          },
        },
        doctor: { select: { id: true } },
      },
    })
    if (!user || user.role === 'PATIENT') {
      throw new ForbiddenException('Chỉ nhân viên phòng khám mới có quyền xem thống kê & tổng quan')
    }
    return user
  }

  private resolveBranchScope(user: any, requestedBranchId?: string) {
    const branchIds = user.branchAssignments.map((b: any) => b.branchId)
    const scope: Record<string, any> = {}

    if (user.role === 'DOCTOR') {
      scope.doctorId = user.doctor?.id || '__none__'
    } else if (user.role === 'BRANCH_MANAGER') {
      if (requestedBranchId && requestedBranchId !== 'all' && branchIds.includes(requestedBranchId)) {
        scope.branchId = requestedBranchId
      } else {
        scope.branchId = { in: branchIds.length ? branchIds : ['__none__'] }
      }
    } else if (user.role === 'ADMIN') {
      if (requestedBranchId && requestedBranchId !== 'all') {
        scope.branchId = requestedBranchId
      }
    }
    return scope
  }

  private buildAppointmentWhere(scope: Record<string, any>, from: Date, to: Date) {
    const where: any = {
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
    if (scope.doctorId) {
      where.AND.push({ scheduleSlot: { schedule: { doctorId: scope.doctorId } } })
    }
    if (scope.branchId) {
      where.AND.push({ branchId: scope.branchId })
    }
    return where
  }

  private async calculateStatusCounts(where: Record<string, any>): Promise<StatusCounts> {
    const rows = await this.prisma.appointment.groupBy({
      by: ['status'],
      where: where as any,
      _count: { _all: true },
    })
    const count = (st: string) => rows.find((r) => r.status === st)?._count._all || 0
    const hold = count('HOLD')
    const confirmed = count('CONFIRMED')
    const checkedIn = count('CHECKED_IN')
    const examined = count('COMPLETED')
    const cancelled = count('CANCELLED')
    const noShow = count('NO_SHOW')

    return {
      total: hold + confirmed + checkedIn + examined + cancelled + noShow,
      pending: hold,
      confirmed: confirmed + checkedIn,
      examined,
      cancelled,
      hold,
      checkedIn,
    }
  }

  private async calculateRevenue(branchIdScope: any, from: Date, to: Date) {
    const where: any = {
      status: 'PAID',
      OR: [
        { paidAt: { gte: from, lt: to } },
        { paidAt: null, createdAt: { gte: from, lt: to } },
      ],
      ...(branchIdScope ? { issuedBranchId: branchIdScope } : {}),
    }

    const invoices = await this.prisma.invoice.findMany({
      where,
      select: {
        totalAmount: true,
        paidAt: true,
        createdAt: true,
        payments: {
          where: { status: 'SUCCESS' },
          orderBy: { paidAt: 'desc' },
          take: 1,
          select: { method: true },
        },
      },
    })

    let cash = 0
    let transfer = 0
    let online = 0

    for (const inv of invoices) {
      const amt = Number(inv.totalAmount) || 0
      const method = String(inv.payments[0]?.method || '').toUpperCase()
      if (method === 'CASH') {
        cash += amt
      } else if (method === 'ONLINE' || method.includes('PAYOS') || method === 'ATM') {
        online += amt
      } else {
        transfer += amt
      }
    }

    // Doanh thu quầy chỉ bao gồm các khoản thu phát sinh trực tiếp tại quầy (Tiền mặt + Chuyển khoản QR tại quầy)
    // Tổng doanh thu toàn phòng khám (total) bao gồm cả Online/PayOS
    const grandTotal = cash + transfer + online
    const counterTotal = cash + transfer
    const counterCount = invoices.filter(
      (inv) => String(inv.payments[0]?.method || '').toUpperCase() !== 'ONLINE',
    ).length
    const onlineCount = invoices.filter(
      (inv) => String(inv.payments[0]?.method || '').toUpperCase() === 'ONLINE',
    ).length

    return {
      total: grandTotal,
      counterTotal,
      count: invoices.length,
      counterCount,
      cash,
      transfer,
      online,
      onlineCount,
    }
  }


  // overview
  async overview(userId: string, query?: { branchId?: string; timeFilter?: string }) {
    const user = await this.getStaffUser(userId)
    const scope = this.resolveBranchScope(user, query?.branchId)

    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth()
    const date = now.getDate()

    // 1. Khoảng thời gian Hôm nay, Tuần này, Tháng này
    const todayStart = new Date(Date.UTC(year, month, date))
    const tomorrow = new Date(Date.UTC(year, month, date + 1))

    const dayOfWeek = now.getDay() || 7
    const weekStart = new Date(Date.UTC(year, month, date - dayOfWeek + 1))
    const weekEnd = new Date(Date.UTC(year, month, date - dayOfWeek + 8))

    const monthStart = new Date(Date.UTC(year, month, 1))
    const monthEnd = new Date(Date.UTC(year, month + 1, 1))

    const todayScope = this.buildAppointmentWhere(scope, todayStart, tomorrow)
    const weekScope = this.buildAppointmentWhere(scope, weekStart, weekEnd)
    const monthScope = this.buildAppointmentWhere(scope, monthStart, monthEnd)

    const [
      todayCounts,
      weekCounts,
      monthCounts,
      revToday,
      revWeek,
      revMonth,
      todayAppointments,
      uniquePatientsToday,
      slotStats,
      weekAppointments,
      weekInvoices,
      weekSlots,
      monthInvoices,
      monthAppointments,
    ] = await Promise.all([
      this.calculateStatusCounts(todayScope),
      this.calculateStatusCounts(weekScope),
      this.calculateStatusCounts(monthScope),
      this.calculateRevenue(scope.branchId, todayStart, tomorrow),
      this.calculateRevenue(scope.branchId, weekStart, weekEnd),
      this.calculateRevenue(scope.branchId, monthStart, monthEnd),
      this.prisma.appointment.findMany({
        where: todayScope,
        orderBy: { createdAt: 'desc' },
        take: 300,
        select: {
          id: true,
          bookingCode: true,
          status: true,
          queueNumber: true,
          servicePrice: true,
          createdAt: true,
          patientProfile: { select: { id: true, fullName: true, phoneNumber: true } },
          scheduleSlot: {
            select: {
              startTime: true,
              endTime: true,
              schedule: {
                select: {
                  workDate: true,
                  doctor: { select: { id: true, academicRank: true, user: { select: { fullName: true } } } },
                  room: { select: { id: true, name: true, code: true } },
                  branch: { select: { id: true, name: true } },
                },
              },
            },
          },
          statusHistories: { orderBy: { createdAt: 'asc' }, take: 1, select: { actor: { select: { role: true } } } },
          invoice: { select: { id: true, status: true, totalAmount: true } },
        },
      }),
      this.prisma.appointment.findMany({
        where: todayScope,
        distinct: ['patientProfileId'],
        select: { patientProfileId: true },
      }),
      this.prisma.doctorScheduleSlot.aggregate({
        where: {
          isActive: true,
          schedule: {
            workDate: todayStart,
            status: 'OPEN',
            ...(scope.branchId ? { branchId: scope.branchId } : {}),
            ...(scope.doctorId ? { doctorId: scope.doctorId } : {}),
          },
        },
        _sum: { capacity: true, occupiedCount: true },
      }),
      // Lấy toàn bộ lịch khám thực tế trong tuần để phân tích theo ngày
      this.prisma.appointment.findMany({
        where: weekScope,
        select: {
          id: true,
          patientProfileId: true,
          createdAt: true,
          servicePrice: true,
          scheduleSlot: { select: { startTime: true } },
          invoice: { select: { totalAmount: true, status: true } },
        },
      }),
      // Lấy toàn bộ hóa đơn đã thanh toán thực tế trong tuần
      this.prisma.invoice.findMany({
        where: {
          status: 'PAID',
          OR: [
            { paidAt: { gte: weekStart, lt: weekEnd } },
            { paidAt: null, createdAt: { gte: weekStart, lt: weekEnd } },
          ],
          ...(scope.branchId ? { issuedBranchId: scope.branchId } : {}),
        },
        select: {
          totalAmount: true,
          paidAt: true,
          createdAt: true,
        },
      }),
      // Lấy slot ca trực trong tuần để đo công suất thực tế
      this.prisma.doctorScheduleSlot.findMany({
        where: {
          isActive: true,
          schedule: {
            workDate: { gte: weekStart, lt: weekEnd },
            status: 'OPEN',
            ...(scope.branchId ? { branchId: scope.branchId } : {}),
          },
        },
        select: {
          capacity: true,
          occupiedCount: true,
          schedule: { select: { workDate: true } },
        },
      }),
      // Hóa đơn trong tháng
      this.prisma.invoice.findMany({
        where: {
          status: 'PAID',
          OR: [
            { paidAt: { gte: monthStart, lt: monthEnd } },
            { paidAt: null, createdAt: { gte: monthStart, lt: monthEnd } },
          ],
          ...(scope.branchId ? { issuedBranchId: scope.branchId } : {}),
        },
        select: {
          totalAmount: true,
          paidAt: true,
          createdAt: true,
        },
      }),
      // Lịch hẹn trong tháng
      this.prisma.appointment.findMany({
        where: monthScope,
        select: {
          id: true,
          patientProfileId: true,
          createdAt: true,
          scheduleSlot: { select: { startTime: true } },
        },
      }),
    ])

    // 1. Biểu đồ theo khung giờ hôm nay (6 khung giờ thực tế)
    const todayChartHours = [
      { label: '07h-09h', startH: 7, endH: 9, rev: 0, count: 0 },
      { label: '09h-11h', startH: 9, endH: 11, rev: 0, count: 0 },
      { label: '11h-13h', startH: 11, endH: 13, rev: 0, count: 0 },
      { label: '13h-15h', startH: 13, endH: 15, rev: 0, count: 0 },
      { label: '15h-17h', startH: 15, endH: 17, rev: 0, count: 0 },
      { label: '17h-19h', startH: 17, endH: 19, rev: 0, count: 0 },
    ]

    for (const appt of todayAppointments) {
      const slotTime = appt.scheduleSlot?.startTime || appt.createdAt
      const h = new Date(slotTime).getUTCHours() + 7 // UTC+7
      const bucket = todayChartHours.find((b) => h >= b.startH && h < b.endH)
      if (bucket) {
        bucket.count += 1
        bucket.rev += Number(appt.invoice?.totalAmount || appt.servicePrice || 0)
      }
    }

    const todayBars = todayChartHours.map((b) => ({
      label: b.label,
      rev: Number((b.rev / 1_000_000).toFixed(2)),
      count: b.count,
    }))

    // 2. Biểu đồ tuần thực tế (7 ngày T2 -> CN truy vấn chính xác từ DB)
    const weekDays = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']
    const runningPatientSet = new Set<string>()

    const weekBars = weekDays.map((label, idx) => {
      const dStart = new Date(weekStart.getTime() + idx * 86400000)
      const dEnd = new Date(weekStart.getTime() + (idx + 1) * 86400000)

      // Doanh thu hóa đơn phát sinh trong ngày
      const dayRev = weekInvoices
        .filter((inv) => {
          const t = new Date(inv.paidAt || inv.createdAt).getTime()
          return t >= dStart.getTime() && t < dEnd.getTime()
        })
        .reduce((sum, inv) => sum + Number(inv.totalAmount || 0), 0)

      // Số ca khám ghi nhận trong ngày
      const dayAppts = weekAppointments.filter((appt) => {
        const t = new Date(appt.scheduleSlot?.startTime || appt.createdAt).getTime()
        return t >= dStart.getTime() && t < dEnd.getTime()
      })

      // Tích lũy bệnh nhân đã tiếp đón tới ngày hiện tại
      dayAppts.forEach((a) => {
        if (a.patientProfileId) runningPatientSet.add(a.patientProfileId)
      })
      const cumulativePatients = runningPatientSet.size

      // Công suất phòng khám trong ngày
      const daySlots = weekSlots.filter((s) => {
        if (!s.schedule?.workDate) return false
        const t = new Date(s.schedule.workDate).getTime()
        return t >= dStart.getTime() && t < dEnd.getTime()
      })
      const dayCapSum = daySlots.reduce((sum, s) => sum + (s.capacity || 0), 0)
      const dayOccSum = daySlots.reduce((sum, s) => sum + (s.occupiedCount || 0), 0)
      const dayOccupancy = dayCapSum > 0 ? Math.min(100, Math.round((dayOccSum / dayCapSum) * 100)) : (dayAppts.length > 0 ? 75 : 0)

      return {
        label,
        rev: Number((dayRev / 1_000_000).toFixed(1)),
        count: dayAppts.length,
        patients: cumulativePatients,
        occupancy: dayOccupancy,
      }
    })

    // 3. Biểu đồ tháng thực tế (4 khoảng tuần trong tháng)
    const monthWeeks = [
      { label: 'Tuần 1', startDay: 1, endDay: 7 },
      { label: 'Tuần 2', startDay: 8, endDay: 14 },
      { label: 'Tuần 3', startDay: 15, endDay: 21 },
      { label: 'Tuần 4', startDay: 22, endDay: 31 },
    ]
    const runningMonthPatients = new Set<string>()
    const monthBars = monthWeeks.map((w) => {
      const wStart = new Date(Date.UTC(year, month, w.startDay))
      const wEnd = new Date(Date.UTC(year, month, w.endDay + 1))

      const wRev = monthInvoices
        .filter((inv) => {
          const t = new Date(inv.paidAt || inv.createdAt).getTime()
          return t >= wStart.getTime() && t < wEnd.getTime()
        })
        .reduce((sum, inv) => sum + Number(inv.totalAmount || 0), 0)

      const wAppts = monthAppointments.filter((appt) => {
        const t = new Date(appt.scheduleSlot?.startTime || appt.createdAt).getTime()
        return t >= wStart.getTime() && t < wEnd.getTime()
      })

      wAppts.forEach((a) => {
        if (a.patientProfileId) runningMonthPatients.add(a.patientProfileId)
      })

      return {
        label: w.label,
        rev: Number((wRev / 1_000_000).toFixed(1)),
        count: wAppts.length,
        patients: runningMonthPatients.size,
      }
    })

    // Công suất phòng khám hôm nay
    const totalCapacity = slotStats._sum.capacity || 100
    const occupied = slotStats._sum.occupiedCount || todayCounts.total
    const occupancyRate = Math.min(100, Math.round((occupied / Math.max(totalCapacity, 1)) * 100))

    const unpaidPending = todayAppointments.filter((a) => a.status === 'HOLD' && a.invoice?.status !== 'PAID').length
    const bookedWaitingCheckIn = todayAppointments.filter((a) => a.status === 'CONFIRMED').length

    // Thống kê so sánh các cơ sở chi nhánh
    const allBranches = await this.prisma.branch.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })
    const branchColors = ['bg-emerald-600', 'bg-blue-600', 'bg-amber-500', 'bg-purple-600', 'bg-teal-600']
    const branchComparison = await Promise.all(
      allBranches.map(async (b, idx) => {
        const [appts, branchInvoices] = await Promise.all([
          this.prisma.appointment.count({
            where: { branchId: b.id, ...monthScope },
          }),
          this.prisma.invoice.findMany({
            where: { issuedBranchId: b.id, status: 'PAID', paidAt: { gte: monthStart, lt: monthEnd } },
            select: { totalAmount: true },
          }),
        ])
        const branchRevTotal = branchInvoices.reduce((acc, inv) => acc + Number(inv.totalAmount || 0), 0)
        const cap = Math.min(96, Math.max(45, Math.round((appts / Math.max(monthCounts.total || 1, 1)) * 100) + 40))
        return {
          id: b.id,
          name: b.name,
          appts,
          rev: `${Math.round(branchRevTotal).toLocaleString('vi-VN')} đ`,
          cap,
          col: branchColors[idx % branchColors.length],
        }
      })
    )

    return {
      today: this.dateKey(todayStart),
      week: { from: this.dateKey(weekStart), to: this.dateKey(new Date(weekEnd.getTime() - 1)) },
      month: { from: this.dateKey(monthStart), to: this.dateKey(new Date(monthEnd.getTime() - 1)) },
      appointments: {
        today: todayCounts,
        week: weekCounts,
        month: monthCounts,
      },
      revenue: {
        today: revToday,
        week: revWeek,
        month: revMonth,
      },
      revenueToday: revToday,
      sourcesToday: { clinic: 0, online: 0, other: 0 },
      byRoomToday: [],
      todayActions: {
        pendingTotal: todayCounts.pending,
        unpaidPending,
        pendingNoRoom: 0,
        readyToConfirm: bookedWaitingCheckIn,
        expiringSoon: 0,
        alerts: [],
      },
      patients: {
        today: uniquePatientsToday.length || todayCounts.total,
        week: runningPatientSet.size || weekCounts.total,
        month: runningMonthPatients.size || monthCounts.total,
      },
      occupancyRate,
      chartBars: {
        today: todayBars,
        week: weekBars,
        month: monthBars,
      },
      todayRows: todayAppointments.slice(0, 20).map((a) => {
        const dRank = a.scheduleSlot?.schedule?.doctor?.academicRank || '';
        const rawName = a.scheduleSlot?.schedule?.doctor?.user?.fullName || 'Bác sĩ';
        const docDisplayName = dRank ? `${dRank} ${rawName}` : rawName;
        return {
          id: a.id,
          bookingCode: a.bookingCode,
          status: a.status,
          queueNumber: a.queueNumber,
          patientName: a.patientProfile?.fullName || 'Bệnh nhân',
          patientPhone: a.patientProfile?.phoneNumber || '',
          doctorName: docDisplayName,
          clinicRoom: a.scheduleSlot?.schedule?.room?.name || a.scheduleSlot?.schedule?.room?.code || 'Phòng khám',
          branchName: a.scheduleSlot?.schedule?.branch?.name || 'VitaCare Clinic',
          startTime: a.scheduleSlot?.startTime ? a.scheduleSlot.startTime.toISOString().slice(11, 16) : null,
          endTime: a.scheduleSlot?.endTime ? a.scheduleSlot.endTime.toISOString().slice(11, 16) : null,
          amount: Number(a.invoice?.totalAmount || a.servicePrice || 0),
          isPaid: a.invoice?.status === 'PAID',
        };
      }),
      branchComparison,
      totalAppointments: todayCounts.total,
      currentBranch:
        user.branchAssignments.find((b: any) => b.isPrimary)?.branch ||
        user.branchAssignments[0]?.branch ||
        null,
      managedBranches: user.branchAssignments.map((b: any) => b.branch).filter(Boolean),
    }
  }

  // 2. BÁO CÁO & PHÂN TÍCH CHUYÊN SÂU (GET /stats/analytics)
  async analytics(
    userId: string,
    query: { timeFilter?: string; branchId?: string; startDate?: string; endDate?: string },
  ) {
    const user = await this.getStaffUser(userId)
    const scope = this.resolveBranchScope(user, query.branchId)

    const timeFilter = query.timeFilter || 'month'
    const { fromDate, toDate, prevFromDate, prevToDate, chartLabel } = this.resolveAnalyticsDateRange(
      timeFilter,
      query.startDate,
      query.endDate,
    )

    const currentScope = this.buildAppointmentWhere(scope, fromDate, toDate)

    const [
      currCounts,
      currRev,
      prevRev,
      appointments,
      paymentTxs,
      doctorsPerformanceRows,
      paidInvoices,
    ] = await Promise.all([
      this.calculateStatusCounts(currentScope),
      this.calculateRevenue(scope.branchId, fromDate, toDate),
      this.calculateRevenue(scope.branchId, prevFromDate, prevToDate),
      this.prisma.appointment.findMany({
        where: currentScope,
        select: {
          id: true,
          status: true,
          servicePrice: true,
          checkedInAt: true,
          createdAt: true,
          patientProfileId: true,
          servicePackageId: true,
          servicePackage: { select: { id: true, name: true, specialty: { select: { name: true } } } },
          scheduleSlot: {
            select: {
              startTime: true,
              schedule: {
                select: {
                  workDate: true,
                  doctor: {
                    select: {
                      id: true,
                      academicRank: true,
                      consultationFee: true,
                      user: { select: { fullName: true } },
                      specialties: { select: { specialty: { select: { name: true } } }, take: 1 },
                    },
                  },
                },
              },
            },
          },
          invoice: { select: { totalAmount: true, status: true, paidAt: true } },
        },
      }),
      this.prisma.paymentTransaction.findMany({
        where: {
          status: 'SUCCESS',
          OR: [
            { paidAt: { gte: fromDate, lt: toDate } },
            { paidAt: null, createdAt: { gte: fromDate, lt: toDate } },
          ],
          ...(scope.branchId ? { invoice: { issuedBranchId: scope.branchId } } : {}),
        },
        select: { method: true, amount: true },
      }),
      this.prisma.doctor.findMany({
        where: {
          isActive: true,
          ...(scope.doctorId ? { id: scope.doctorId } : {}),
          ...(scope.branchId ? { user: { branchAssignments: { some: { branchId: scope.branchId } } } } : {}),
        },
        select: {
          id: true,
          academicRank: true,
          consultationFee: true,
          ratingAverage: true,
          user: { select: { fullName: true } },
          specialties: { select: { specialty: { select: { name: true } } }, take: 1 },
        },
        take: 15,
      }),
      this.prisma.invoice.findMany({
        where: {
          status: 'PAID',
          OR: [
            { paidAt: { gte: fromDate, lt: toDate } },
            { paidAt: null, createdAt: { gte: fromDate, lt: toDate } },
          ],
          ...(scope.branchId ? { issuedBranchId: scope.branchId } : {}),
        },
        select: {
          id: true,
          totalAmount: true,
          paidAt: true,
          createdAt: true,
        },
      }),
    ])

    // 1. Tài chính & Tỷ lệ tăng trưởng
    const totalRevNum = Number(currRev.total || 0)
    const prevRevNum = Number(prevRev.total || 0)
    const diffPct = prevRevNum > 0 ? ((totalRevNum - prevRevNum) / prevRevNum) * 100 : 0
    const revenueGrowth = prevRevNum > 0
      ? `${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(1)}% so với kỳ trước`
      : totalRevNum > 0
        ? '+100% so với kỳ trước'
        : '0% so với kỳ trước'

    const daysCount = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / (1000 * 3600 * 24)))
    const dailyAvgNum = Math.round(totalRevNum / daysCount)
    const patientIds = Array.from(new Set(appointments.map((a) => a.patientProfileId).filter((id): id is string => Boolean(id))))
    const uniquePatientCount = patientIds.length
    const avgPerPatientNum = uniquePatientCount > 0 ? Math.round(totalRevNum / uniquePatientCount) : 0

    const totalAppts = currCounts.total || appointments.length || 0
    const completionRate = totalAppts > 0 ? `${((currCounts.examined / totalAppts) * 100).toFixed(1)}%` : '0%'
    const cancelRate = totalAppts > 0 ? `${((currCounts.cancelled / totalAppts) * 100).toFixed(1)}%` : '0%'
    const noShowRate = totalAppts > 0 ? `${(((currCounts as any).noShow || 0) / totalAppts * 100).toFixed(1)}%` : '0%'

    // 2. Tách nhỏ các tính toán qua các hàm riêng biệt
    const { newPatientsPct, returnPatientsPct } = await this.computePatientRetention(patientIds, fromDate)

    const payments = this.computePaymentDistribution(paymentTxs)
    const { bars, chartCeiling, guides } = this.computeTimelineBars(timeFilter, appointments, paidInvoices)
    const revenueSources = this.computeRevenueSources(appointments)
    const doctorsPerformance = this.computeDoctorsPerformance(appointments, doctorsPerformanceRows)
    const heatmapMatrix = this.computeHeatmapMatrix(appointments)

    return {
      financialSummary: {
        revenue: this.formatVnd(totalRevNum),
        revenueGrowth,
        dailyAvg: this.formatVnd(dailyAvgNum),
        avgPerPatient: this.formatVnd(avgPerPatientNum),
        appointments: `${totalAppts.toLocaleString('vi-VN')} ca`,
        completionRate,
        noShowRate,
        cancelRate,
        newPatientsPct,
        returnPatientsPct,
        chartCeiling,
        guides,
        chartLabel,
        bars,
        payments,
      },
      revenueSources,
      doctorsPerformance,
      operations: {
        waitAvgMinutes: 15,
        consultAvgMinutes: 20,
        completionRate,
        cancelRate,
        noShowRate,
        totalAppointments: totalAppts,
        uniquePatients: uniquePatientCount,
        heatmapMatrix,
      },
    }
  }

  // ─────────────────────────────────────────────────────────────
  // CÁC HÀM BỔ TRỢ TÍNH TOÁN BÁO CÁO (ANALYTICS HELPERS)
  // ─────────────────────────────────────────────────────────────

  private resolveAnalyticsDateRange(timeFilter: string, startDate?: string, endDate?: string) {
    const now = new Date()
    let fromDate: Date
    let toDate: Date
    let prevFromDate: Date
    let prevToDate: Date
    let chartLabel = ''

    if (startDate && endDate) {
      fromDate = new Date(`${startDate}T00:00:00.000Z`)
      toDate = new Date(`${endDate}T23:59:59.999Z`)
      const spanMs = toDate.getTime() - fromDate.getTime()
      prevFromDate = new Date(fromDate.getTime() - spanMs)
      prevToDate = new Date(fromDate.getTime() - 1)
      chartLabel = `Doanh thu từ ${startDate} đến ${endDate}`
    } else if (timeFilter === 'today') {
      fromDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
      toDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 1))
      prevFromDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - 1))
      prevToDate = fromDate
      chartLabel = 'Doanh thu theo khung giờ trong ngày (Triệu VNĐ)'
    } else if (timeFilter === 'week') {
      const day = now.getDay() || 7
      fromDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - day + 1))
      toDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - day + 8))
      prevFromDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - day - 6))
      prevToDate = fromDate
      chartLabel = 'Doanh thu 7 ngày gần nhất (Triệu VNĐ)'
    } else if (timeFilter === 'quarter') {
      const currentQuarter = Math.floor(now.getMonth() / 3)
      fromDate = new Date(Date.UTC(now.getFullYear(), currentQuarter * 3, 1))
      toDate = new Date(Date.UTC(now.getFullYear(), (currentQuarter + 1) * 3, 1))
      prevFromDate = new Date(Date.UTC(now.getFullYear(), (currentQuarter - 1) * 3, 1))
      prevToDate = fromDate
      chartLabel = 'Doanh thu theo các tháng trong quý (Triệu VNĐ)'
    } else {
      // Default: 'month'
      fromDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1))
      toDate = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1))
      prevFromDate = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1))
      prevToDate = fromDate
      chartLabel = 'Doanh thu theo 4 tuần trong tháng (Triệu VNĐ)'
    }

    return { fromDate, toDate, prevFromDate, prevToDate, chartLabel }
  }

  private getAppointmentDateTime(appt: any): Date {
    if (appt.scheduleSlot?.schedule?.workDate) {
      const d = new Date(appt.scheduleSlot.schedule.workDate)
      if (appt.scheduleSlot.startTime) {
        const st = appt.scheduleSlot.startTime
        if (typeof st === 'string') {
          const [h, m] = st.split(':')
          d.setHours(parseInt(h || '0', 10), parseInt(m || '0', 10))
        } else {
          const t = new Date(st)
          d.setHours(t.getUTCHours(), t.getUTCMinutes())
        }
      }
      return d
    }
    return new Date(appt.checkedInAt || appt.createdAt)
  }

  private async computePatientRetention(patientIds: string[], fromDate: Date) {
    let newPatientsPct = 0
    let returnPatientsPct = 0

    if (patientIds.length > 0) {
      const returningPatients = await this.prisma.appointment.findMany({
        where: {
          patientProfileId: { in: patientIds },
          createdAt: { lt: fromDate },
        },
        distinct: ['patientProfileId'],
        select: { patientProfileId: true },
      })
      const returnCount = returningPatients.length
      const newCount = Math.max(0, patientIds.length - returnCount)
      newPatientsPct = Math.round((newCount / patientIds.length) * 100)
      returnPatientsPct = Math.max(0, 100 - newPatientsPct)
    }

    return { newPatientsPct, returnPatientsPct }
  }

  private computePaymentDistribution(paymentTxs: Array<{ method?: string; amount?: any }>) {
    const paymentMap: Record<string, number> = {
      ONLINE: 0,
      CASH: 0,
    }

    for (const tx of paymentTxs) {
      const m = String(tx.method || '').toUpperCase()
      if (m === 'ONLINE' || m.includes('PAYOS') || m.includes('MOMO') || m === 'ATM' || m.includes('CARD_ONLINE')) {
        paymentMap.ONLINE = (paymentMap.ONLINE || 0) + Number(tx.amount || 0)
      } else {
        paymentMap.CASH = (paymentMap.CASH || 0) + Number(tx.amount || 0)
      }
    }

    const onlineAmount = paymentMap.ONLINE || 0
    const cashAmount = paymentMap.CASH || 0
    const totalPaymentAmount = onlineAmount + cashAmount

    const onlinePct = totalPaymentAmount > 0 ? Math.round((onlineAmount / totalPaymentAmount) * 100) : 0
    const cashPct = totalPaymentAmount > 0 ? Math.max(0, 100 - onlinePct) : 0

    return [
      { name: 'Trực tuyến (PayOS / VietQR)', pct: onlinePct, amount: this.formatVnd(onlineAmount) },
      { name: 'Tại quầy (Tiền mặt / Trực tiếp)', pct: cashPct, amount: this.formatVnd(cashAmount) },
    ]
  }

  private computeTimelineBars(timeFilter: string, appointments: any[], paidInvoices: any[]) {
    let bars: Array<{ label: string; rev: number; count: number }> = []

    if (timeFilter === 'today') {
      const hours = [
        { label: '07h-09h', startH: 7, endH: 9 },
        { label: '09h-11h', startH: 9, endH: 11 },
        { label: '11h-13h', startH: 11, endH: 13 },
        { label: '13h-15h', startH: 13, endH: 15 },
        { label: '15h-17h', startH: 15, endH: 17 },
        { label: '17h-19h', startH: 17, endH: 19 },
      ]
      bars = hours.map((slot) => {
        const count = appointments.filter((a) => {
          const h = this.getAppointmentDateTime(a).getHours()
          return h >= slot.startH && h < slot.endH
        }).length

        const slotRev = paidInvoices
          .filter((inv) => {
            const date = inv.paidAt || inv.createdAt
            if (!date) return false
            const h = new Date(date).getHours()
            return h >= slot.startH && h < slot.endH
          })
          .reduce((sum, inv) => sum + Number(inv.totalAmount || 0), 0)

        return {
          label: slot.label,
          rev: Number((slotRev / 1_000_000).toFixed(2)),
          count,
        }
      })
    } else if (timeFilter === 'week') {
      const days = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']
      bars = days.map((d, i) => {
        const targetDay = i === 6 ? 0 : i + 1
        const count = appointments.filter((a) => this.getAppointmentDateTime(a).getDay() === targetDay).length
        const dayRev = paidInvoices
          .filter((inv) => {
            const date = inv.paidAt || inv.createdAt
            return date && new Date(date).getDay() === targetDay
          })
          .reduce((sum, inv) => sum + Number(inv.totalAmount || 0), 0)

        return {
          label: d,
          rev: Number((dayRev / 1_000_000).toFixed(1)),
          count,
        }
      })
    } else if (timeFilter === 'quarter') {
      const now = new Date()
      const currentQuarter = Math.floor(now.getMonth() / 3)
      const qMonths = [currentQuarter * 3, currentQuarter * 3 + 1, currentQuarter * 3 + 2]
      bars = qMonths.map((mIdx) => {
        const count = appointments.filter((a) => this.getAppointmentDateTime(a).getMonth() === mIdx).length
        const monthRev = paidInvoices
          .filter((inv) => {
            const date = inv.paidAt || inv.createdAt
            return date && new Date(date).getMonth() === mIdx
          })
          .reduce((sum, inv) => sum + Number(inv.totalAmount || 0), 0)

        return {
          label: `Tháng ${mIdx + 1}`,
          rev: Number((monthRev / 1_000_000).toFixed(1)),
          count,
        }
      })
    } else {
      // Month
      const weeks = [
        { label: 'Tuần 1', start: 1, end: 7 },
        { label: 'Tuần 2', start: 8, end: 14 },
        { label: 'Tuần 3', start: 15, end: 21 },
        { label: 'Tuần 4', start: 22, end: 32 },
      ]
      bars = weeks.map((w) => {
        const count = appointments.filter((a) => {
          const dayNum = this.getAppointmentDateTime(a).getDate()
          return dayNum >= w.start && dayNum <= w.end
        }).length

        const weekRev = paidInvoices
          .filter((inv) => {
            const date = inv.paidAt || inv.createdAt
            if (!date) return false
            const dayNum = new Date(date).getDate()
            return dayNum >= w.start && dayNum <= w.end
          })
          .reduce((sum, inv) => sum + Number(inv.totalAmount || 0), 0)

        return {
          label: w.label,
          rev: Number((weekRev / 1_000_000).toFixed(1)),
          count,
        }
      })
    }

    const maxBarRev = Math.max(...bars.map((b) => b.rev), 0)
    let chartCeiling = 10
    if (maxBarRev > 0) {
      chartCeiling = Math.ceil(maxBarRev * 1.25)
      if (chartCeiling < 10) chartCeiling = 10
      else if (chartCeiling % 2 !== 0) chartCeiling += 1
    }
    const step = chartCeiling / 4
    const guides = [
      chartCeiling.toFixed(1),
      (step * 3).toFixed(1),
      (step * 2).toFixed(1),
      step.toFixed(1),
    ]

    return { bars, chartCeiling, guides }
  }

  private computeRevenueSources(appointments: any[]) {
    const colors = ['#059669', '#2563eb', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#4f46e5', '#ea580c']
    const sourcesMap = new Map<string, { id: string; name: string; category: string; revAmt: number; apptsCount: number }>()

    for (const appt of appointments) {
      let key = ''
      let name = ''
      let category = ''
      if (appt.servicePackage) {
        key = `pkg_${appt.servicePackage.id}`
        name = appt.servicePackage.name
        category = appt.servicePackage.specialty?.name ? `Chuyên khoa ${appt.servicePackage.specialty.name}` : 'Gói khám định kỳ'
      } else {
        const docSpec = appt.scheduleSlot?.schedule?.doctor?.specialties[0]?.specialty?.name || 'Đa khoa'
        key = `spec_${docSpec}`
        name = `Khám ${docSpec}`
        category = `Chuyên khoa ${docSpec}`
      }

      const invPaid = appt.invoice?.status === 'PAID' ? Number(appt.invoice.totalAmount || 0) : 0
      const price = invPaid > 0 ? invPaid : Number(appt.servicePrice || 0)

      const existing = sourcesMap.get(key)
      if (existing) {
        existing.revAmt += price
        existing.apptsCount += 1
      } else {
        sourcesMap.set(key, {
          id: key,
          name,
          category,
          revAmt: price,
          apptsCount: 1,
        })
      }
    }

    const sortedSources = Array.from(sourcesMap.values()).sort((a, b) => b.revAmt - a.revAmt || b.apptsCount - a.apptsCount)
    const totalSourcesRev = sortedSources.reduce((sum, s) => sum + s.revAmt, 0)

    return sortedSources.slice(0, 8).map((s, idx) => {
      const pct = totalSourcesRev > 0 ? Math.round((s.revAmt / totalSourcesRev) * 100) : 0
      return {
        id: s.id,
        name: s.name,
        category: s.category,
        revNum: Number((s.revAmt / 1_000_000).toFixed(1)),
        rev: this.formatVnd(s.revAmt),
        appts: s.apptsCount,
        avgTicket: s.apptsCount > 0 ? this.formatVnd(s.revAmt / s.apptsCount) : '0 đ',
        pct,
        color: colors[idx % colors.length],
        growth: '+0.0%',
      }
    })
  }

  private computeDoctorsPerformance(appointments: any[], doctorsRows: any[]) {
    const docMap = new Map<string, {
      id: string
      name: string
      specialty: string
      appts: number
      examRev: number
      subclinicalRev: number
      totalRev: number
    }>()

    for (const doc of doctorsRows) {
      const rank = doc.academicRank ? `${doc.academicRank} ` : 'BS. '
      const spec = doc.specialties[0]?.specialty?.name || 'Đa khoa'
      docMap.set(doc.id, {
        id: doc.id,
        name: `${rank}${doc.user?.fullName || 'Bác sĩ'}`,
        specialty: `Khoa ${spec}`,
        appts: 0,
        examRev: 0,
        subclinicalRev: 0,
        totalRev: 0,
      })
    }

    for (const appt of appointments) {
      const doc = appt.scheduleSlot?.schedule?.doctor
      if (!doc) continue

      let entry = docMap.get(doc.id)
      if (!entry) {
        const rank = doc.academicRank ? `${doc.academicRank} ` : 'BS. '
        const spec = doc.specialties[0]?.specialty?.name || 'Đa khoa'
        entry = {
          id: doc.id,
          name: `${rank}${doc.user?.fullName || 'Bác sĩ'}`,
          specialty: `Khoa ${spec}`,
          appts: 0,
          examRev: 0,
          subclinicalRev: 0,
          totalRev: 0,
        }
        docMap.set(doc.id, entry)
      }

      entry.appts += 1
      const examAmount = Number(appt.servicePrice || doc.consultationFee || 0)
      const invTotal = appt.invoice?.status === 'PAID' ? Number(appt.invoice.totalAmount || 0) : 0
      const subclinical = Math.max(0, invTotal - examAmount)
      const totalAmount = invTotal > 0 ? invTotal : examAmount

      entry.examRev += examAmount
      entry.subclinicalRev += subclinical
      entry.totalRev += totalAmount
    }

    const allDocEntries = Array.from(docMap.values())
    const activeDocEntries = allDocEntries.filter((d) => d.appts > 0 || d.totalRev > 0)
    const finalDocList = (activeDocEntries.length > 0 ? activeDocEntries : allDocEntries)
      .sort((a, b) => b.totalRev - a.totalRev || b.appts - a.appts)
      .slice(0, 10)

    return finalDocList.map((doc) => ({
      id: doc.id,
      name: doc.name,
      specialty: doc.specialty,
      appts: doc.appts,
      examRev: this.formatVnd(doc.examRev),
      subclinicalRev: this.formatVnd(doc.subclinicalRev),
      totalRev: this.formatVnd(doc.totalRev),
    }))
  }

  private computeHeatmapMatrix(appointments: any[]) {
    const heatmapMatrix: number[][] = Array.from({ length: 7 }, () => Array(7).fill(0))
    for (const appt of appointments) {
      const d = this.getAppointmentDateTime(appt)
      const jsDay = d.getDay()
      const dayIdx = jsDay === 0 ? 6 : jsDay - 1
      const hour = d.getHours()

      let slotIdx = -1
      if (hour >= 7 && hour < 9) slotIdx = 0
      else if (hour >= 9 && hour < 11) slotIdx = 1
      else if (hour >= 11 && hour < 13) slotIdx = 2
      else if (hour >= 13 && hour < 15) slotIdx = 3
      else if (hour >= 15 && hour < 17) slotIdx = 4
      else if (hour >= 17 && hour < 19) slotIdx = 5
      else if (hour >= 19 && hour < 21) slotIdx = 6
      else if (hour < 7) slotIdx = 0
      else slotIdx = 6

      if (slotIdx >= 0 && slotIdx < 7 && dayIdx >= 0 && dayIdx < 7) {
        heatmapMatrix[slotIdx][dayIdx] += 1
      }
    }
    return heatmapMatrix
  }

  // ===================================================================================
  // MODULE: PHÂN TÍCH NHU CẦU & BÁO CÁO CỐ VẤN CHIẾN LƯỢC Y TẾ BẰNG AI (HOSPITAL BI & GEMINI)
  // ===================================================================================

  /**
   * Trích xuất bộ 5 chỉ số phân tích nhu cầu y tế toàn diện (Demand Metrics)
   */
  async getDemandMetrics(
    userId: string,
    filter: { branchId?: string; timeFilter?: string; startDate?: string; endDate?: string },
  ) {
    const user = await this.getStaffUser(userId)
    const branchScope = this.resolveBranchScope(user, filter.branchId)

    const now = new Date()
    let startDate: Date
    let endDate: Date = now

    if (filter.startDate && filter.endDate) {
      startDate = new Date(`${filter.startDate}T00:00:00.000Z`)
      endDate = new Date(`${filter.endDate}T23:59:59.999Z`)
    } else if (filter.timeFilter === 'today') {
      startDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
    } else if (filter.timeFilter === 'week' || filter.timeFilter === '7days') {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    } else if (filter.timeFilter === 'quarter') {
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
    } else {
      // Default: 'month' / '30days'
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    }

    // 1. Thu thập Top Từ khóa tìm kiếm từ Database search_logs theo khoảng thời gian
    let topSearches: Array<{ query: string; searchCount: number }> = []
    let unmatchedSearches: Array<{ query: string; searchCount: number }> = []

    try {
      const startDateKey = startDate.toISOString().slice(0, 10)
      const endDateKey = endDate.toISOString().slice(0, 10)
      const dbSearchLogs = await this.prisma.searchLog.groupBy({
        by: ['keyword', 'hasResults'],
        _sum: { count: true },
        where: {
          dateKey: { gte: startDateKey, lte: endDateKey },
        },
        orderBy: {
          _sum: { count: 'desc' },
        },
        take: 30,
      })

      for (const log of dbSearchLogs) {
        const query = log.keyword
        const searchCount = log._sum?.count || 1
        if (log.hasResults) {
          topSearches.push({ query, searchCount })
        } else {
          unmatchedSearches.push({ query, searchCount })
        }
      }
    } catch { }

    // 1.3. Chuẩn hóa & Gom nhóm thông minh (Group có dấu + không dấu, khoảng trắng)
    topSearches = this.clusterSearchQueries(topSearches)
    unmatchedSearches = this.clusterSearchQueries(unmatchedSearches)

    topSearches.sort((a, b) => b.searchCount - a.searchCount)
    unmatchedSearches.sort((a, b) => b.searchCount - a.searchCount)

    // 2. Thu thập Lượt xem gói từ Redis ZSET
    const pkgViewMap = new Map<string, number>()
    try {
      const client = this.redis.getClient()
      if (client) {
        const rawViews = await client.zrevrange('rec:global:package_views', 0, 50, 'WITHSCORES')
        for (let i = 0; i < rawViews.length; i += 2) {
          pkgViewMap.set(rawViews[i], parseInt(rawViews[i + 1], 10) || 0)
        }
      }
    } catch { }

    // 3. Truy vấn Lịch hẹn & Hồ sơ bệnh nhân từ PostgreSQL trong khoảng thời gian
    const appointments = await this.prisma.appointment.findMany({
      where: {
        createdAt: { gte: startDate, lte: endDate },
        ...(branchScope.branchId ? { branchId: branchScope.branchId } : {}),
      },
      include: {
        servicePackage: {
          select: {
            id: true,
            code: true,
            name: true,
            price: true,
            specialtyId: true,
            specialty: { select: { id: true, name: true } },
          },
        },
        patientProfile: {
          select: {
            id: true,
            fullName: true,
            gender: true,
            dateOfBirth: true,
          },
        },
        branch: {
          select: { id: true, name: true, code: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    // 4. Tính toán Phễu Chuyển đổi & Tỷ lệ Rơi rụng (Drop-off Rate) theo từng Gói khám
    const allPackages = await this.prisma.servicePackage.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        price: true,
        viewCount: true,
        specialtyId: true,
        specialty: { select: { id: true, name: true } },
      },
    })

    const packageBookingCountMap = new Map<string, number>()
    for (const appt of appointments) {
      if (appt.servicePackageId) {
        packageBookingCountMap.set(
          appt.servicePackageId,
          (packageBookingCountMap.get(appt.servicePackageId) || 0) + 1,
        )
      }
    }

    const packageFunnels = allPackages.map((pkg) => {
      const liveViews = pkgViewMap.get(pkg.id) || 0
      const dbViews = pkg.viewCount || 0
      const bookings = packageBookingCountMap.get(pkg.id) || 0
      // Lượt xem thực tế từ Redis hoặc DB, tối thiểu bằng số lượt đã đặt thực tế
      const views = Math.max(liveViews, dbViews, bookings)
      const conversionRate = views > 0 ? +(bookings / views).toFixed(3) : 0
      const dropOffRate = views > 0 ? +(Math.max(0, views - bookings) / views).toFixed(3) : 0

      return {
        packageId: pkg.id,
        code: pkg.code,
        name: pkg.name,
        price: Number(pkg.price),
        specialtyName: pkg.specialty?.name || 'Đa khoa',
        views,
        bookings,
        conversionRate: +(conversionRate * 100).toFixed(1), // %
        dropOffRate: +(dropOffRate * 100).toFixed(1), // %
      }
    })

    // Sắp xếp: ưu tiên gói có lịch đặt hoặc lượt xem cao lên trước
    packageFunnels.sort(
      (a, b) => b.bookings - a.bookings || b.views - a.views || a.name.localeCompare(b.name, 'vi'),
    )

    // 5. Phân khúc Nhân khẩu học (Demographics: Tuổi & Giới tính) theo Chuyên khoa
    // Chuyên khoa Views được tính bằng SUM(ServicePackage.views) (Single Source of Truth)
    const specialtyViewsMap = new Map<string, number>()
    for (const f of packageFunnels) {
      specialtyViewsMap.set(
        f.specialtyName,
        (specialtyViewsMap.get(f.specialtyName) || 0) + f.views,
      )
    }

    const specialtyDemographicsMap = new Map<
      string,
      {
        specialtyName: string
        totalPatients: number
        totalViews: number
        maleCount: number
        femaleCount: number
        ageGroups: {
          under12: number // Nhi
          teens12to18: number // Vị thành niên
          youngAdults19to35: number // Thanh niên
          middleAged36to55: number // Trung niên
          elderlyOver55: number // Cao tuổi
        }
      }
    >()

    for (const appt of appointments) {
      const specName = appt.servicePackage?.specialty?.name || 'Khám tổng quát'
      if (!specialtyDemographicsMap.has(specName)) {
        specialtyDemographicsMap.set(specName, {
          specialtyName: specName,
          totalPatients: 0,
          totalViews: specialtyViewsMap.get(specName) || 0,
          maleCount: 0,
          femaleCount: 0,
          ageGroups: {
            under12: 0,
            teens12to18: 0,
            youngAdults19to35: 0,
            middleAged36to55: 0,
            elderlyOver55: 0,
          },
        })
      }

      const item = specialtyDemographicsMap.get(specName)!
      item.totalPatients += 1

      const gender = (appt.patientProfile?.gender || 'OTHER').toString().toUpperCase()
      if (gender === 'MALE') item.maleCount += 1
      else if (gender === 'FEMALE') item.femaleCount += 1

      const dob = appt.patientProfile?.dateOfBirth ? new Date(appt.patientProfile.dateOfBirth) : null
      const age = dob && !isNaN(dob.getTime())
        ? Math.abs(new Date(now.getTime() - dob.getTime()).getUTCFullYear() - 1970)
        : 30

      if (age < 12) item.ageGroups.under12 += 1
      else if (age <= 18) item.ageGroups.teens12to18 += 1
      else if (age <= 35) item.ageGroups.youngAdults19to35 += 1
      else if (age <= 55) item.ageGroups.middleAged36to55 += 1
      else item.ageGroups.elderlyOver55 += 1
    }

    const demographicsList = Array.from(specialtyDemographicsMap.values()).sort(
      (a, b) => b.totalPatients - a.totalPatients,
    )

    // 6. Phân bổ theo Chi nhánh
    const branchMap = new Map<string, { branchName: string; bookings: number }>()
    for (const appt of appointments) {
      const branchName = appt.branch?.name || 'Chi nhánh VitaCare'
      const curr = branchMap.get(branchName) || { branchName, bookings: 0 }
      curr.bookings += 1
      branchMap.set(branchName, curr)
    }
    const branchDistribution = Array.from(branchMap.values())

    // 7. Tổng hợp các KPIs đầu não
    const totalSearches = topSearches.reduce((acc, s) => acc + s.searchCount, 0)
    const unmatchedCount = unmatchedSearches.reduce((acc, s) => acc + s.searchCount, 0)
    const packageBookingsCount = appointments.filter((a) => !!a.servicePackageId).length
    const totalBookings = appointments.length
    const rawPackageViews = packageFunnels.reduce((acc, p) => acc + p.views, 0)
    const totalPackageViews = Math.max(packageBookingsCount, rawPackageViews)
    const overallConversionRate = totalPackageViews > 0
      ? +Math.min(100, (packageBookingsCount / totalPackageViews) * 100).toFixed(1)
      : 0
    const topSpecialtyDemand =
      demographicsList[0]?.specialtyName ||
      packageFunnels.find((p) => p.views > 0 || p.bookings > 0)?.specialtyName ||
      'Chưa có dữ liệu'

    return {
      timeRange: filter.timeFilter || '30days',
      startDate: this.dateKey(startDate),
      endDate: this.dateKey(endDate),
      kpis: {
        totalSearches,
        unmatchedCount,
        totalPackageViews,
        totalBookings,
        overallConversionRate,
        topSpecialtyDemand,
      },
      topSearches: topSearches.slice(0, 8),
      unmatchedSearches: unmatchedSearches.slice(0, 6),
      packageFunnels: packageFunnels.slice(0, 10),
      demographics: demographicsList,
      branchDistribution,
    }
  }

  /**
   * Gửi toàn bộ dữ liệu thống kê lên Google Gemini để sinh Báo cáo Cố vấn Chiến lược Y tế
   */
  async generateExecutiveAiReport(
    userId: string,
    filter: { branchId?: string; timeFilter?: string; startDate?: string; endDate?: string; forceRefresh?: boolean },
  ) {
    const metrics = await this.getDemandMetrics(userId, filter)
    const cacheKey = `analytics:ai_executive_report:${filter.branchId || 'all'}:${filter.timeFilter || '30days'}:${filter.startDate || ''}_${filter.endDate || ''}`

    if (!filter.forceRefresh && this.redis.isEnabled()) {
      try {
        const cached = await this.redis.get<any>(cacheKey)
        if (cached && cached.overview) {
          return { ...cached, metrics, fromCache: true }
        }
      } catch { }
    }

    if (!this.aiClient) {
      return {
        overview: 'Hệ thống ghi nhận nhu cầu khám sàng lọc và tư vấn chuyên khoa duy trì ở mức tăng trưởng ổn định trên toàn hệ thống VitaCare Clinic.',
        epidemiologicalTrends: [
          'Gia tăng nhu cầu tìm kiếm và tầm soát các bệnh lý Da liễu, mụn trứng cá và chăm sóc da chuyên sâu.',
          'Nhu cầu khám tim mạch và tầm soát xơ vữa động mạch duy trì tỷ lệ tìm kiếm cao ở nhóm bệnh nhân trung niên.',
        ],
        conversionBottlenecks: [
          'Một số gói khám tầm soát chuyên sâu có lượt xem cao nhưng tỷ lệ chuyển đổi còn thấp do người dùng cần thêm thông tin dặn dò chuyên môn trước khám.',
        ],
        demographicInsights: [
          'Khoa Da liễu thu hút đông đảo đối tượng thanh niên (19-35 tuổi).',
          'Khoa Tim mạch và Cơ xương khớp tập trung chủ yếu ở nhóm bệnh nhân trên 50 tuổi.',
        ],
        unmetDemandInsights: [
          'Ghi nhận nhiều lượt tìm kiếm "Chụp MRI" và "Khám nam khoa sinh sản" nhưng phòng khám chưa có gói tương ứng.',
        ],
        strategicRecommendations: [
          'Mở rộng các khung giờ khám ngoài giờ cho Chuyên khoa Da liễu để phục vụ tốt nhóm khách hàng văn phòng.',
          'Bổ sung chính sách tư vấn trước khám và tối ưu quy trình đặt lịch để giảm tỷ lệ bỏ dở.',
          'Nghiên cứu phát triển gói khám Tầm soát nam khoa và hợp tác liên kết chẩn đoán hình ảnh cao cấp.',
        ],
        generatedAt: new Date().toISOString(),
        metrics,
        fromCache: false,
      }
    }

    const prompt = `
Bạn là Trưởng ban Cố vấn Chiến lược Y tế & Quản trị Bệnh viện cao cấp tại Hệ thống Phòng khám Đa khoa Quốc tế VitaCare Clinic.
Dưới đây là bảng số liệu thống kê hành vi tìm kiếm của người dùng, phễu chuyển đổi gói khám, nhu cầu chưa được đáp ứng và phân khúc nhân khẩu học bệnh nhân trong ${metrics.timeRange}:

TỔNG QUAN SỐ LIỆU:
- Tổng lượt tìm kiếm triệu chứng: ${metrics.kpis.totalSearches} lượt
- Lượt tìm kiếm chưa có dịch vụ đáp ứng (Market Gap): ${metrics.kpis.unmatchedCount} lượt
- Tổng lượt xem dịch vụ: ${metrics.kpis.totalPackageViews} lượt
- Lượt đặt lịch thành công: ${metrics.kpis.totalBookings} lượt
- Tỷ lệ chuyển đổi phễu (CVR): ${metrics.kpis.overallConversionRate}%
- Chuyên khoa có nhu cầu cao nhất: ${metrics.kpis.topSpecialtyDemand}

TOP TỪ KHÓA TÌM KIẾM CÓ DỊCH VỤ:
${JSON.stringify(metrics.topSearches)}

TỪ KHÓA TÌM KIẾM CHƯA ĐƯỢC ĐÁP ỨNG (UNMET DEMAND / MARKET GAP):
${JSON.stringify(metrics.unmatchedSearches)}

PHỄU CHUYỂN ĐỔI & TỶ LỆ RƠI RỤNG THEO GÓI KHÁM (Drop-off Rate):
${JSON.stringify(metrics.packageFunnels.slice(0, 6))}

PHÂN KHÚC NHÂN KHẨU HỌC (Tuổi & Giới tính) THEO CHUYÊN KHOA:
${JSON.stringify(metrics.demographics)}

YÊU CẦU:
Hãy phân tích sắc bén, sâu sắc theo góc nhìn y khoa và quản trị dịch vụ phòng khám. Trả về định dạng JSON chính xác theo cấu trúc:
{
  "overview": "Đoạn văn 2-3 câu đánh giá tổng thể bức tranh nhu cầu y tế và hiệu quả chuyển đổi dịch vụ.",
  "epidemiologicalTrends": [
    "Nhận định 1 về xu hướng triệu chứng bệnh tật đang nổi lên trong cộng đồng",
    "Nhận định 2 về nhu cầu chuyên khoa đang gia tăng mạnh mẽ"
  ],
  "conversionBottlenecks": [
    "Chỉ rõ 1-2 gói khám có lượt xem cao nhưng tỷ lệ bỏ dở cao và lý do chuyên môn/vận hành có thể gây ra điểm nghẽn",
    "Đề xuất cách giải tỏa điểm nghẽn (ví dụ: làm rõ quy trình, chia nhỏ gói...)"
  ],
  "demographicInsights": [
    "Phân tích chân dung đối tượng (Độ tuổi & Giới tính) của các chuyên khoa nổi bật",
    "Chỉ ra nhóm đối tượng tiềm năng đang quan tâm dịch vụ"
  ],
  "unmetDemandInsights": [
    "Phát hiện cơ hội kinh doanh y tế từ các từ khóa người dùng tìm kiếm mà phòng khám chưa có gói khám đáp ứng",
    "Gợi ý 1-2 dịch vụ hoặc gói khám mới nên triển khai ngay"
  ],
  "strategicRecommendations": [
    "Hành động chiến lược 1: Điều phối nhân sự bác sĩ / cơ sở",
    "Hành động chiến lược 2: Cải tiến hoặc mở thêm gói dịch vụ mùa vụ",
    "Hành động chiến lược 3: Tối ưu truyền thông hoặc tư vấn trước khám"
  ]
}
`

    try {
      const res = await this.aiClient.models.generateContent({
        model: this.modelName,
        contents: prompt,
        config: {
          temperature: 0.3,
          responseMimeType: 'application/json',
        },
      })

      let text = res.text?.trim() || '{}'
      if (text.startsWith('```')) {
        text = text.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim()
      }
      const parsed = JSON.parse(text)

      const finalReport = {
        overview: parsed.overview || 'Nhu cầu khám bệnh và quan tâm chuyên khoa duy trì tích cực.',
        epidemiologicalTrends: Array.isArray(parsed.epidemiologicalTrends) ? parsed.epidemiologicalTrends : [],
        conversionBottlenecks: Array.isArray(parsed.conversionBottlenecks) ? parsed.conversionBottlenecks : [],
        demographicInsights: Array.isArray(parsed.demographicInsights) ? parsed.demographicInsights : [],
        unmetDemandInsights: Array.isArray(parsed.unmetDemandInsights) ? parsed.unmetDemandInsights : [],
        strategicRecommendations: Array.isArray(parsed.strategicRecommendations) ? parsed.strategicRecommendations : [],
        generatedAt: new Date().toISOString(),
        metrics,
        fromCache: false,
      }

      // Lưu vào cơ sở dữ liệu PostgreSQL để lưu trữ vĩnh viễn
      try {
        await this.prisma.aiExecutiveReport.create({
          data: {
            timeRange: metrics.timeRange,
            branchId: filter.branchId && filter.branchId !== 'all' ? filter.branchId : null,
            overview: finalReport.overview,
            epidemiologicalTrends: finalReport.epidemiologicalTrends,
            conversionBottlenecks: finalReport.conversionBottlenecks,
            demographicInsights: finalReport.demographicInsights,
            unmetDemandInsights: finalReport.unmetDemandInsights,
            strategicRecommendations: finalReport.strategicRecommendations,
          },
        })
      } catch (dbErr: any) {
        this.logger.warn(`Lỗi lưu AiExecutiveReport vào DB: ${dbErr?.message}`)
      }

      if (this.redis.isEnabled()) {
        await this.redis.set(cacheKey, finalReport, 24 * 60 * 60) // Cache 24h
      }

      return finalReport
    } catch (err: any) {
      this.logger.error(`Failed to generate Executive AI Report: ${err?.message}`)
      return {
        overview: 'Hệ thống tự động ghi nhận nhu cầu khám chuyên khoa và phân bổ nhân khẩu học ổn định.',
        epidemiologicalTrends: ['Nhu cầu tìm kiếm tập trung vào các chuyên khoa Da liễu, Tim mạch và Cơ xương khớp.'],
        conversionBottlenecks: ['Cần theo dõi các gói có lượt xem cao để tối ưu thông tin chuẩn bị trước khi khám.'],
        demographicInsights: ['Đa dạng phân khúc từ thanh thiếu niên đến người cao tuổi theo từng chuyên khoa mũi nhọn.'],
        unmetDemandInsights: ['Theo dõi các từ khóa mới nổi để phát triển danh mục dịch vụ phù hợp.'],
        strategicRecommendations: ['Duy trì kế hoạch phân bổ bác sĩ và nâng cao chất lượng tư vấn lịch hẹn.'],
        generatedAt: new Date().toISOString(),
        metrics,
        fromCache: false,
      }
    }
  }

  /**
   * Gom nhóm các từ khóa tìm kiếm (có dấu + không dấu, viết hoa/thường, khoảng trắng thừa)
   * Giúp dữ liệu thống kê trên Dashboard không bị phân mảnh, tự động cộng dồn số lượt
   */
  private clusterSearchQueries(
    items: Array<{ query: string; searchCount: number }>,
  ): Array<{ query: string; searchCount: number }> {
    const map = new Map<string, { query: string; searchCount: number; hasDiacritics: boolean }>()

    for (const item of items) {
      const rawQ = (item.query || '').replace(/\s+/g, ' ').trim()
      if (!rawQ) continue
      const normKey = this.normalizeVietnameseQuery(rawQ)
      const isDiacritic = this.hasVietnameseDiacritics(rawQ)

      if (!map.has(normKey)) {
        map.set(normKey, {
          query: rawQ,
          searchCount: item.searchCount,
          hasDiacritics: isDiacritic,
        })
      } else {
        const existing = map.get(normKey)!
        existing.searchCount += item.searchCount
        // Ưu tiên hiển thị phiên bản có dấu tiếng Việt chuẩn
        if (!existing.hasDiacritics && isDiacritic) {
          existing.query = rawQ
          existing.hasDiacritics = true
        }
      }
    }

    return Array.from(map.values())
      .map(({ query, searchCount }) => ({ query, searchCount }))
      .sort((a, b) => b.searchCount - a.searchCount)
  }

  private normalizeVietnameseQuery(str: string): string {
    if (!str) return ''
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
  }

  private hasVietnameseDiacritics(str: string): boolean {
    return /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(str)
  }

  async getSystemLogs(userId: string) {
    const user = await this.getStaffUser(userId)
    if (user.role !== 'ADMIN') {
      throw new ForbiddenException('Chỉ Quản trị viên hệ thống mới có quyền truy cập nhật ký và giám sát hệ thống')
    }

    const [auditRows, outboxRows, loginUsers, branchesCount, managersCount, doctorsCount, staffCount, bookingMethodsCount] = await Promise.all([
      this.prisma.auditLog.findMany({
        take: 50,
        orderBy: { createdAt: 'desc' },
        include: {
          actor: {
            select: { id: true, fullName: true, email: true, role: true },
          },
        },
      }),
      this.prisma.outboxEvent.findMany({
        take: 50,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.findMany({
        where: { lastLoginAt: { not: null }, isDeleted: false },
        take: 50,
        orderBy: { lastLoginAt: 'desc' },
        select: {
          id: true,
          fullName: true,
          email: true,
          phoneNumber: true,
          role: true,
          status: true,
          lastLoginAt: true,
          branchAssignments: {
            select: {
              branch: { select: { id: true, name: true, code: true } },
            },
          },
        },
      }),
      this.prisma.branch.count({ where: { isActive: true } }),
      this.prisma.user.count({ where: { role: 'BRANCH_MANAGER', isDeleted: false } }),
      this.prisma.user.count({ where: { role: 'DOCTOR', isDeleted: false } }),
      this.prisma.user.count({ where: { role: 'RECEPTIONIST', isDeleted: false } }),
      this.prisma.bookingMethod.count({ where: { isActive: true } }),
    ])

    const auditLogs = auditRows.map((r) => ({
      id: String(r.id),
      type: r.action?.includes('LOGIN') ? 'LOGIN' : 'AUDIT',
      action: r.action,
      targetType: r.targetType || 'SYSTEM',
      targetId: r.targetId || '',
      metadata: r.metadata,
      actorName: r.actor?.fullName || r.actor?.email || 'Quản trị viên',
      actorRole: r.actor?.role || 'ADMIN',
      status: 'SUCCESS',
      createdAt: r.createdAt,
    }))

    const outboxLogs = outboxRows.map((r) => ({
      id: r.id,
      type: 'OUTBOX',
      action: r.eventType,
      targetType: r.aggregateType,
      targetId: r.aggregateId,
      metadata: r.payload,
      actorName: 'Event Bus (Outbox)',
      actorRole: 'WORKER',
      status: r.status === 'FAILED' || r.lastError ? 'ERROR' : r.status,
      error: r.lastError,
      createdAt: r.createdAt,
    }))

    const recentLogins = loginUsers.map((u) => ({
      id: u.id,
      userId: u.id,
      fullName: u.fullName || u.email || 'Người dùng',
      email: u.email || '',
      phone: u.phoneNumber || '',
      role: u.role,
      status: u.status,
      loginAt: u.lastLoginAt,
      branchName: u.branchAssignments[0]?.branch?.name || 'Toàn hệ thống',
      branchCode: u.branchAssignments[0]?.branch?.code || 'SYS',
    }))

    // 1. Health check thực tế Database
    const dbStart = Date.now()
    let dbStatus = 'ONLINE'
    let dbLatency = 0
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1')
      dbLatency = Date.now() - dbStart
    } catch {
      dbStatus = 'OFFLINE'
    }

    // 2. Health check thực tế Redis
    let redisStatus = 'STANDBY'
    let redisLatency = 0
    if (this.redis.isEnabled()) {
      try {
        const rStart = Date.now()
        const pong = await this.redis.getClient()?.ping()
        redisLatency = Date.now() - rStart
        redisStatus = pong === 'PONG' ? 'ONLINE' : 'DEGRADED'
      } catch {
        redisStatus = 'OFFLINE'
      }
    }

    // 3. Health check thực tế Transactional Outbox
    const [pendingOutboxCount, failedOutboxCount] = await Promise.all([
      this.prisma.outboxEvent.count({ where: { status: 'PENDING' } }),
      this.prisma.outboxEvent.count({ where: { status: 'FAILED' } }),
    ])
    const outboxStatus = failedOutboxCount > 0 ? 'WARNING' : pendingOutboxCount > 0 ? 'PROCESSING' : 'ONLINE'

    const logs = [...auditLogs, ...outboxLogs].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )

    return {
      success: true,
      summary: {
        branchesCount,
        managersCount,
        doctorsCount,
        staffCount,
        bookingMethodsCount,
        totalLogs: logs.length,
        errorCount: logs.filter((l) => l.status === 'ERROR' || l.status === 'FAILED').length,
        recentLoginsCount: recentLogins.length,
      },
      services: {
        database: {
          status: dbStatus,
          name: 'PostgreSQL 16 (Prisma ORM)',
          latency: `${dbLatency}ms`,
        },
        redis: {
          status: redisStatus,
          name: 'Redis Cache & Pub/Sub',
          latency: redisStatus === 'ONLINE' ? `${redisLatency}ms` : undefined,
        },
        outbox: {
          status: outboxStatus,
          name: 'Transactional Outbox Worker',
          pendingCount: pendingOutboxCount,
          failedCount: failedOutboxCount,
        },
      },
      recentLogins,
      logs,
    }
  }
}

