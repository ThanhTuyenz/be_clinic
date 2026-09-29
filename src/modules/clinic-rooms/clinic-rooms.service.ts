import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js'
import { parseDateRange, getStaffUser, resolveBranchId } from '../../common/utils/staff.utils.js'

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



  async getRoomsStatus(userId: string, query?: { date?: string; branchId?: string }) {
    const user = await getStaffUser(this.prisma, userId)
    const branchId = resolveBranchId(user, query?.branchId)
    const { from, to, dateKey } = parseDateRange(query?.date)

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
