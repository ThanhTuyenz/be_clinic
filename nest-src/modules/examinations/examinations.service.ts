import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js'

@Injectable()
export class ExaminationsService {
  constructor(private readonly prisma: PrismaService) {}

  private async authorize(userId: string, appointmentId: string, write: boolean) {
    const [user, appointment] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, doctor: { select: { id: true } } } }),
      this.prisma.appointment.findUnique({ where: { id: appointmentId }, select: { id: true, doctorId: true, branchId: true } }),
    ])
    if (!appointment) throw new NotFoundException('Không tìm thấy lịch khám')
    const allowed = user && (
      user.role === 'ADMIN' ||
      (user.role === 'DOCTOR' && user.doctor?.id === appointment.doctorId) ||
      (!write && ['BRANCH_MANAGER', 'RECEPTIONIST'].includes(user.role))
    )
    if (!allowed) throw new ForbiddenException('Không có quyền truy cập hồ sơ khám này')
  }

  async findByAppointment(userId: string, appointmentId: string) {
    await this.authorize(userId, appointmentId, false)
    const row = await this.prisma.examination.findUnique({ where: { appointmentId } })
    return { examination: row ? { ...(row.payload as object), id: row.id, appointmentId: row.appointmentId, updatedAt: row.updatedAt } : null }
  }

  async upsert(userId: string, body: Record<string, unknown>) {
    const appointmentId = String(body.appointmentId || '').trim()
    await this.authorize(userId, appointmentId, true)
    const { appointmentId: _ignored, ...payload } = body
    const row = await this.prisma.examination.upsert({
      where: { appointmentId },
      create: { appointmentId, createdById: userId, payload: payload as Prisma.InputJsonValue },
      update: { payload: payload as Prisma.InputJsonValue },
    })
    return { examination: { ...(row.payload as object), id: row.id, appointmentId: row.appointmentId, updatedAt: row.updatedAt } }
  }
}
