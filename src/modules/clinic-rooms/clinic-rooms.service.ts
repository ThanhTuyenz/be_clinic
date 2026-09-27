import { ForbiddenException, Injectable } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js'

@Injectable()
export class ClinicRoomsService {
  constructor(private readonly prisma: PrismaService) {}

  list(activeOnly = true) {
    return this.prisma.clinicRoom.findMany({
      where: activeOnly ? { isActive: true, branch: { isActive: true } } : {},
      include: { branch: { select: { id: true, code: true, name: true } } },
      orderBy: [{ branch: { name: 'asc' } }, { code: 'asc' }],
    })
  }

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
      throw new ForbiddenException('Chỉ nhân viên phòng khám mới có quyền truy cập trạng thái phòng khám')
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

  async getRoomsStatus(userId: string, query?: { date?: string; branchId?: string }) {
    const user = await this.getStaffUser(userId)
    const branchId = this.resolveBranchId(user, query?.branchId)
    const { from, to, dateKey } = this.parseDateRange(query?.date)

    const roomWhere: any = { isActive: true }
    if (branchId) {
      roomWhere.branchId = branchId
    }

    const roomsList = await this.prisma.clinicRoom.findMany({
      where: roomWhere,
      select: {
        id: true,
        code: true,
        name: true,
        specialties: {
          select: {
            specialty: { select: { name: true } },
          },
        },
        schedules: {
          where: { workDate: { gte: from, lt: to } },
          select: {
            doctor: {
              select: {
                academicRank: true,
                user: { select: { fullName: true } },
              },
            },
          },
        },
      },
      orderBy: { code: 'asc' },
    })

    const apptRows: any[] = await (this.prisma.appointment as any).groupBy({
      by: ['clinicRoomId', 'status'],
      where: {
        scheduleSlot: {
          schedule: {
            workDate: { gte: from, lt: to },
            ...(branchId ? { branchId } : {}),
          },
        },
      } as any,
      _count: { _all: true },
    })

    const roomApptMap = new Map<string, { total: number; pending: number; confirmed: number; examined: number }>()

    for (const row of apptRows) {
      if (!row.clinicRoomId) continue
      const current = roomApptMap.get(row.clinicRoomId) || { total: 0, pending: 0, confirmed: 0, examined: 0 }
      const count = row._count._all

      current.total += count
      if (row.status === 'HOLD') current.pending += count
      else if (row.status === 'CONFIRMED' || row.status === 'CHECKED_IN') current.confirmed += count
      else if (row.status === 'COMPLETED') current.examined += count

      roomApptMap.set(row.clinicRoomId, current)
    }

    const rooms = roomsList.map((r) => {
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
}
