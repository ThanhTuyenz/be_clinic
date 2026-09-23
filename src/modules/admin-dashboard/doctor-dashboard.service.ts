import { ForbiddenException, Injectable } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js'

export type DoctorQueueSummaryDto = {
  date: string
  doctorId: string
  doctorName: string
  appointments: {
    total: number
    pending: number
    confirmed: number
    examined: number
    cancelled: number
  }
}

@Injectable()
export class DoctorDashboardService {
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

  async getQueueSummary(userId: string, dateStr?: string): Promise<DoctorQueueSummaryDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        role: true,
        doctor: { select: { id: true, academicRank: true } },
      },
    })

    if (!user || user.role !== 'DOCTOR' || !user.doctor?.id) {
      throw new ForbiddenException('Chỉ bác sĩ mới có quyền xem hàng đợi khám bệnh của bác sĩ')
    }

    const doctorId = user.doctor.id
    const { from, to, dateKey } = this.parseDateRange(dateStr)

    const rows = await this.prisma.appointment.groupBy({
      by: ['status'],
      where: {
        scheduleSlot: {
          schedule: {
            doctorId,
            workDate: { gte: from, lt: to },
          },
        },
      },
      _count: { _all: true },
    })

    const countStatus = (st: string) => rows.find((r) => r.status === st)?._count._all || 0
    const hold = countStatus('HOLD')
    const confirmed = countStatus('CONFIRMED')
    const checkedIn = countStatus('CHECKED_IN')
    const examined = countStatus('COMPLETED')
    const cancelled = countStatus('CANCELLED')

    const displayName = `${user.doctor.academicRank ? user.doctor.academicRank + ' ' : ''}${user.fullName || ''}`.trim()

    return {
      date: dateKey,
      doctorId,
      doctorName: displayName,
      appointments: {
        total: hold + confirmed + checkedIn + examined + cancelled,
        pending: hold,
        confirmed: confirmed + checkedIn,
        examined,
        cancelled,
      },
    }
  }
}
