import { ForbiddenException, Injectable } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js'

@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

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

    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    const todayScope = {
      ...appointmentScope,
      scheduleSlot: { schedule: { workDate: { gte: start, lt: end } } },
    }

    const [total, booked, checkedIn, inExamination, completed, pendingPayment, cancelled, paid, revenue] = await Promise.all([
      this.prisma.appointment.count({ where: todayScope }),
      this.prisma.appointment.count({ where: { ...todayScope, status: 'BOOKED' } }),
      this.prisma.appointment.count({ where: { ...todayScope, status: 'CHECKED_IN' } }),
      this.prisma.appointment.count({ where: { ...todayScope, status: 'IN_EXAMINATION' } }),
      this.prisma.appointment.count({ where: { ...todayScope, status: 'COMPLETED' } }),
      this.prisma.appointment.count({ where: { ...todayScope, status: 'PENDING_PAYMENT' } }),
      this.prisma.appointment.count({ where: { ...todayScope, status: 'CANCELLED' } }),
      this.prisma.invoice.count({ where: { appointment: todayScope, status: 'PAID' } }),
      this.prisma.invoice.aggregate({
        where: { appointment: todayScope, status: 'PAID' },
        _sum: { totalAmount: true },
      }),
    ])

    return {
      totalAppointments: total,
      today: {
        total,
        booked,
        checkedIn,
        inExamination,
        completed,
        pending: booked + pendingPayment,
        pendingPayment,
        cancelled,
        paid,
        failed: 0,
        revenue: Number(revenue._sum.totalAmount || 0),
      },
    }
  }
}
