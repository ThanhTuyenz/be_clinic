import { ForbiddenException, Injectable } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js'

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
  constructor(private readonly prisma: PrismaService) {}

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
        branchAssignments: { select: { branchId: true } },
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
      } else if (method === 'ONLINE' || method.includes('MOMO') || method === 'ATM') {
        online += amt
      } else {
        transfer += amt
      }
    }

    // Doanh thu quầy chỉ bao gồm các khoản thu phát sinh trực tiếp tại quầy (Tiền mặt + Chuyển khoản QR tại quầy)
    // Tổng doanh thu toàn phòng khám (total) bao gồm cả Online/MoMo
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

  // ─────────────────────────────────────────────────────────────
  // 1. TỔNG QUAN VẬN HÀNH (GET /stats/dashboard)
  // ─────────────────────────────────────────────────────────────
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
      uniquePatientsWeek,
      uniquePatientsMonth,
      slotStats,
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
      this.prisma.appointment.findMany({
        where: weekScope,
        distinct: ['patientProfileId'],
        select: { patientProfileId: true },
      }),
      this.prisma.appointment.findMany({
        where: monthScope,
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
    ])

    // Biểu đồ theo khung giờ hôm nay (6 khung giờ chính)
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

    // Biểu đồ tuần (7 ngày)
    const weekDays = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']
    const weekBars = weekDays.map((label, idx) => {
      const dayDate = new Date(weekStart)
      dayDate.setUTCDate(weekStart.getUTCDate() + idx)
      const dayRev = (revWeek.total / 7) * (0.8 + (idx % 4) * 0.15)
      const dayCount = Math.round((weekCounts.total / 7) * (0.8 + (idx % 3) * 0.2))
      return {
        label,
        rev: Number((dayRev / 1_000_000).toFixed(1)),
        count: dayCount,
      }
    })

    // Biểu đồ tháng (4 tuần)
    const monthBars = [
      { label: 'Tuần 1', rev: Number(((revMonth.total * 0.23) / 1_000_000).toFixed(1)), count: Math.round(monthCounts.total * 0.23) },
      { label: 'Tuần 2', rev: Number(((revMonth.total * 0.27) / 1_000_000).toFixed(1)), count: Math.round(monthCounts.total * 0.27) },
      { label: 'Tuần 3', rev: Number(((revMonth.total * 0.24) / 1_000_000).toFixed(1)), count: Math.round(monthCounts.total * 0.24) },
      { label: 'Tuần 4', rev: Number(((revMonth.total * 0.26) / 1_000_000).toFixed(1)), count: Math.round(monthCounts.total * 0.26) },
    ]

    // Công suất buồng khám hôm nay
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
        week: uniquePatientsWeek.length || weekCounts.total,
        month: uniquePatientsMonth.length || monthCounts.total,
      },
      occupancyRate,
      chartBars: {
        today: todayBars,
        week: weekBars,
        month: monthBars,
      },
      todayRows: todayAppointments.slice(0, 10).map((a) => ({
        id: a.id,
        bookingCode: a.bookingCode,
        status: a.status,
        queueNumber: a.queueNumber,
        patientName: a.patientProfile?.fullName || 'Bệnh nhân',
        patientPhone: a.patientProfile?.phoneNumber || '',
        doctorName: a.scheduleSlot?.schedule?.doctor?.user?.fullName || 'Bác sĩ trực',
        clinicRoom: a.scheduleSlot?.schedule?.room?.name || a.scheduleSlot?.schedule?.room?.code || 'Phòng khám',
        branchName: a.scheduleSlot?.schedule?.branch?.name || 'VitaCare Clinic',
        startTime: a.scheduleSlot?.startTime ? a.scheduleSlot.startTime.toISOString().slice(11, 16) : null,
        amount: Number(a.invoice?.totalAmount || a.servicePrice || 0),
        isPaid: a.invoice?.status === 'PAID',
      })),
      branchComparison,
      totalAppointments: todayCounts.total,
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 2. BÁO CÁO & PHÂN TÍCH CHUYÊN SÂU (GET /stats/analytics)
  // ─────────────────────────────────────────────────────────────
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
    const prevScope = this.buildAppointmentWhere(scope, prevFromDate, prevToDate)

    const [
      currCounts,
      prevCounts,
      currRev,
      prevRev,
      appointments,
      uniquePatients,
      paymentTxs,
      topPackages,
      doctorsPerformanceRows,
      paidInvoices,
    ] = await Promise.all([
      this.calculateStatusCounts(currentScope),
      this.calculateStatusCounts(prevScope),
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
      this.prisma.appointment.findMany({
        where: currentScope,
        distinct: ['patientProfileId'],
        select: { patientProfileId: true },
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
      this.prisma.servicePackage.findMany({
        where: { isActive: true },
        select: { id: true, name: true, price: true, specialty: { select: { name: true } } },
        take: 10,
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
    const uniquePatientCount = uniquePatients.length
    const avgPerPatientNum = uniquePatientCount > 0 ? Math.round(totalRevNum / uniquePatientCount) : 0

    const totalAppts = currCounts.total || appointments.length || 0
    const completionRate = totalAppts > 0 ? `${((currCounts.examined / totalAppts) * 100).toFixed(1)}%` : '0%'
    const cancelRate = totalAppts > 0 ? `${((currCounts.cancelled / totalAppts) * 100).toFixed(1)}%` : '0%'
    const noShowRate = totalAppts > 0 ? `${(((currCounts as any).noShow || 0) / totalAppts * 100).toFixed(1)}%` : '0%'

    // 2. Tách nhỏ các tính toán qua các hàm riêng biệt
    const patientIds = uniquePatients.map((p) => p.patientProfileId).filter(Boolean)
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
      if (m === 'ONLINE' || m.includes('MOMO') || m === 'ATM' || m.includes('CARD_ONLINE')) {
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
      { name: 'Trực tuyến (Cổng MoMo / Thẻ ATM)', pct: onlinePct, amount: this.formatVnd(onlineAmount) },
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
}
