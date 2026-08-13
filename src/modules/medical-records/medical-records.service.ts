import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js'
import { UpdateMedicalRecordDto } from './dtos/update-medical-record.dto.js'

@Injectable()
export class MedicalRecordsService {
  constructor(private readonly prisma: PrismaService) {}

  private recordCode(patientProfileId: string) {
    return `MR-${patientProfileId.replaceAll('-', '').slice(0, 12).toUpperCase()}`
  }

  private async authorize(userId: string, patientProfileId: string, write: boolean) {
    const [user, patient] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, doctor: { select: { id: true } }, patientProfiles: { select: { id: true } } },
      }),
      this.prisma.patientProfile.findUnique({ where: { id: patientProfileId }, select: { id: true } }),
    ])
    if (!patient) throw new NotFoundException('Không tìm thấy hồ sơ bệnh nhân')
    if (!user) throw new ForbiddenException('Tài khoản không hợp lệ')
    if (user.role === 'ADMIN') return
    if (user.role === 'PATIENT') {
      if (write || !user.patientProfiles.some((profile) => profile.id === patientProfileId)) {
        throw new ForbiddenException('Không có quyền truy cập hồ sơ bệnh án này')
      }
      return
    }
    if (user.role === 'DOCTOR' && user.doctor?.id) {
      const assigned = await this.prisma.appointment.findFirst({
        where: { patientProfileId, doctorId: user.doctor.id },
        select: { id: true },
      })
      if (assigned) return
    }
    throw new ForbiddenException('Không có quyền truy cập hồ sơ bệnh án này')
  }

  async findByPatient(userId: string, patientProfileId: string) {
    await this.authorize(userId, patientProfileId, false)
    const patient = await this.prisma.patientProfile.findUniqueOrThrow({
      where: { id: patientProfileId },
      include: {
        medicalRecord: {
          include: {
            visits: {
              include: {
                appointment: {
                  include: {
                    doctor: { select: { id: true, fullName: true, academicRank: true } },
                    branch: { select: { id: true, name: true } },
                    scheduleSlot: { include: { schedule: { include: { room: true } } } },
                  },
                },
              },
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    })
    return { patientProfile: patient, medicalRecord: patient.medicalRecord }
  }

  async update(userId: string, patientProfileId: string, input: UpdateMedicalRecordDto) {
    await this.authorize(userId, patientProfileId, true)
    const data = Object.fromEntries(
      Object.entries(input).map(([key, value]) => [key, typeof value === 'string' ? value.trim() || null : value]),
    )
    const medicalRecord = await this.prisma.medicalRecord.upsert({
      where: { patientProfileId },
      update: data,
      create: { patientProfileId, recordCode: this.recordCode(patientProfileId), ...data },
    })
    return { medicalRecord }
  }
}
