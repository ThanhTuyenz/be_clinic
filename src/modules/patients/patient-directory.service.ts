import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Gender, Prisma } from '@prisma/client';
import { getStaffUser } from '../../common/utils/staff.utils.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { resolvePatientCode } from './patient-code.js';

@Injectable()
export class PatientDirectoryService {
  constructor(private readonly prisma: PrismaService) {}

  async patients(userId: string, query: Record<string, string | undefined>) {
    await getStaffUser(this.prisma, userId)
    const page = Math.max(Number(query.page) || 1, 1)
    const pageSize = Math.min(Math.max(Number(query.pageSize) || 50, 1), 500)
    const q = String(query.q || '').trim()
    const searchTerm = q || String(query.patientCode || query.name || query.phone || query.account || '').trim()

    const where: any = searchTerm
      ? {
          OR: [
            { patientCode: { contains: searchTerm, mode: 'insensitive' } },
            { nationalId: { contains: searchTerm, mode: 'insensitive' } },
            { fullName: { contains: searchTerm, mode: 'insensitive' } },
            { phoneNumber: { contains: searchTerm } },
            { account: { phoneNumber: { contains: searchTerm } } },
            { account: { email: { contains: searchTerm, mode: 'insensitive' } } },
          ],
        }
      : {}

    const [rows, total] = await Promise.all([
      this.prisma.patientProfile.findMany({
        where,
        select: {
          id: true,
          patientCode: true,
          fullName: true,
          phoneNumber: true,
          nationalId: true,
          healthInsuranceNumber: true,
          dateOfBirth: true,
          gender: true,
          address: true,
          createdAt: true,
          account: { select: { id: true, email: true, phoneNumber: true } },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { fullName: 'asc' },
      }),
      this.prisma.patientProfile.count({ where }),
    ])

    return {
      patients: rows.map((row) => ({
        ...row,
        patientCode: row.patientCode || row.nationalId || row.id,
        phone: row.phoneNumber || row.account?.phoneNumber || '',
        email: row.account?.email || '',
      })),
      total,
      page,
      pageSize,
    }
  }

  async patientByCode(userId: string, rawCode: string) {
    await getStaffUser(this.prisma, userId)
    const code = String(rawCode || '').trim()
    if (!code) throw new BadRequestException('Vui lòng cung cấp mã bệnh nhân, CCCD hoặc số điện thoại')
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(code)
    const row = await this.prisma.patientProfile.findFirst({
      where: {
        OR: [
          { patientCode: { equals: code, mode: 'insensitive' } },
          { nationalId: code },
          { phoneNumber: code },
          { account: { phoneNumber: code } },
          ...(isUuid ? [{ id: code }] : []),
        ],
      },
      include: { account: { select: { id: true, email: true, phoneNumber: true } } },
    })
    if (!row) throw new NotFoundException('Không tìm thấy thông tin bệnh nhân')
    return {
      patient: {
        ...row,
        patientCode: row.patientCode || row.nationalId || row.id,
        phone: row.phoneNumber || row.account?.phoneNumber,
        email: row.account?.email,
      },
    }
  }

  async resolveReceptionProfile(tx: Prisma.TransactionClient, input: Record<string, any>): Promise<string> {
    let patientProfileId = String(input.patient?.id || input.patient?.patientId || '')
    if (!patientProfileId && input.patientEmailOrPhone) {
      const account = await tx.user.findFirst({
        where: { OR: [{ email: input.patientEmailOrPhone }, { phoneNumber: input.patientEmailOrPhone }] },
        include: { patientProfiles: { orderBy: { isMainProfile: 'desc' }, take: 1 } },
      })
      patientProfileId = account?.patientProfiles[0]?.id || ''
    }
    if (!patientProfileId && input.patient?.fullName) {
      const patient = input.patient
      const patientCode = await resolvePatientCode(tx, patient.nationalId, patient.healthInsuranceNumber)

      const created = await tx.patientProfile.create({
        data: {
          patientCode,
          fullName: String(patient.fullName),
          phoneNumber: patient.phoneNumber || patient.phone || null,
          nationalId: patient.nationalId || null,
          dateOfBirth: new Date(patient.dateOfBirth || patient.dob || '1990-01-01'),
          gender: patient.gender && Object.values(Gender).includes(String(patient.gender).toUpperCase() as Gender)
            ? String(patient.gender).toUpperCase() as Gender
            : null,
          address: patient.address || null,
        },
      })
      patientProfileId = created.id
    }
    if (!patientProfileId) throw new BadRequestException('Chưa chọn hồ sơ bệnh nhân')

    return patientProfileId;
  }
}
