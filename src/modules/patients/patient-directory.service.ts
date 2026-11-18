import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Gender, Prisma } from '@prisma/client';
import { getStaffUser } from '../../common/utils/staff.utils.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { resolvePatientCode } from './patient-code.js';
import { formatPatientAddress, normalizePatientAddressInput } from './patient-address.js';

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
          streetAddress: true,
          wardName: true,
          provinceName: true,
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
        address: formatPatientAddress(row),
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
        address: formatPatientAddress(row),
        patientCode: row.patientCode || row.nationalId || row.id,
        phone: row.phoneNumber || row.account?.phoneNumber,
        email: row.account?.email,
      },
    }
  }

  async resolveReceptionProfile(tx: Prisma.TransactionClient, input: Record<string, any>): Promise<string> {
    let patientProfileId = String(input.patient?.id || input.patient?.patientId || '')
    let accountId: string | undefined
    if (!patientProfileId && input.patientEmailOrPhone) {
      const account = await tx.user.findFirst({
        where: { OR: [{ email: input.patientEmailOrPhone }, { phoneNumber: input.patientEmailOrPhone }] },
        include: { patientProfiles: { orderBy: { isMainProfile: 'desc' }, take: 1 } },
      })
      patientProfileId = account?.patientProfiles[0]?.id || ''
      accountId = account?.id
    }
    if (!patientProfileId && input.patient?.fullName) {
      const patient = input.patient
      if (!accountId && patient.accountId) {
        const account = await tx.user.findUnique({ where: { id: patient.accountId }, select: { id: true } })
        accountId = account?.id
      }
      if (!accountId) throw new BadRequestException('Hồ sơ bệnh nhân phải thuộc một tài khoản. Vui lòng chọn tài khoản bệnh nhân trước.')
      const phoneNumber = patient.phoneNumber || patient.phone
      const gender = typeof patient.gender === 'string' ? patient.gender.toUpperCase() : undefined
      if (typeof phoneNumber !== 'string' || !phoneNumber.trim() || !Object.values(Gender).includes(gender)) {
        throw new BadRequestException('Vui lòng nhập số điện thoại và giới tính hợp lệ cho bệnh nhân.')
      }
      const dateOfBirth = new Date(patient.dateOfBirth || patient.dob)
      if (!Number.isFinite(dateOfBirth.getTime())) throw new BadRequestException('Ngày sinh bệnh nhân không hợp lệ.')
      const patientCode = await resolvePatientCode(tx, patient.nationalId, patient.healthInsuranceNumber)

      const created = await tx.patientProfile.create({
        data: {
          account: { connect: { id: accountId } },
          patientCode,
          fullName: String(patient.fullName),
          phoneNumber: phoneNumber.trim(),
          nationalId: patient.nationalId || null,
          dateOfBirth,
          gender,
          ...normalizePatientAddressInput({
            streetAddress: patient.streetAddress,
            wardCode: patient.wardCode,
            wardName: patient.wardName,
            provinceCode: patient.provinceCode,
            provinceName: patient.provinceName,
            address: patient.address,
          }),
        },
      })
      patientProfileId = created.id
    }
    if (!patientProfileId) throw new BadRequestException('Chưa chọn hồ sơ bệnh nhân')

    return patientProfileId;
  }
}
