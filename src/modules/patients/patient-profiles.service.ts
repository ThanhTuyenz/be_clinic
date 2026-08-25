import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { CreatePatientProfileDto } from './patient-profiles.dto.js';

@Injectable()
export class PatientProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  list(accountId: string) {
    return this.prisma.patientProfile.findMany({ where: { accountId }, orderBy: [{ isMainProfile: 'desc' }, { createdAt: 'asc' }] });
  }

  async create(accountId: string, dto: CreatePatientProfileDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const count = await tx.patientProfile.count({ where: { accountId } });
        const makeMain = dto.isMainProfile === true || count === 0;
        if (makeMain) await tx.patientProfile.updateMany({ where: { accountId, isMainProfile: true }, data: { isMainProfile: false } });

        const computedAddress = dto.address?.trim() || [
          dto.streetAddress?.trim(),
          dto.wardName?.trim(),
          dto.districtName?.trim(),
          dto.provinceName?.trim()
        ].filter(Boolean).join(', ');

        const yy = String(new Date().getFullYear()).slice(-2);
        const prefix = `BN${yy}`;
        const lastProfile = await tx.patientProfile.findFirst({
          where: { patientCode: { startsWith: prefix } },
          orderBy: { patientCode: 'desc' },
          select: { patientCode: true },
        });
        let seq = 1;
        if (lastProfile?.patientCode && lastProfile.patientCode.startsWith(prefix)) {
          const num = parseInt(lastProfile.patientCode.replace(prefix, ''), 10);
          if (!Number.isNaN(num)) seq = num + 1;
        }
        const patientCode = `${prefix}${String(seq).padStart(5, '0')}`;

        return tx.patientProfile.create({
          data: {
            accountId,
            patientCode,
            fullName: dto.fullName.trim(),
            dateOfBirth: new Date(`${dto.dateOfBirth}T00:00:00.000Z`),
            gender: dto.gender,
            phoneNumber: dto.phoneNumber?.trim() || null,
            nationalId: dto.nationalId?.trim() || null,
            healthInsuranceNumber: dto.healthInsuranceNumber?.trim() || null,
            provinceCode: dto.provinceCode?.trim() || null,
            provinceName: dto.provinceName?.trim() || null,
            districtCode: dto.districtCode?.trim() || null,
            districtName: dto.districtName?.trim() || null,
            wardCode: dto.wardCode?.trim() || null,
            wardName: dto.wardName?.trim() || null,
            streetAddress: dto.streetAddress?.trim() || null,
            address: computedAddress || null,
            ethnicity: dto.ethnicity?.trim() || null,
            nationality: dto.nationality?.trim() || 'Việt Nam',
            occupation: dto.occupation?.trim() || null,
            guardianName: dto.guardianName?.trim() || null,
            guardianPhone: dto.guardianPhone?.trim() || null,
            guardianRelationship: dto.guardianRelationship?.trim() || null,
            relationshipToAccount: dto.relationshipToAccount ?? (makeMain ? 'SELF' : 'OTHER'),
            isMainProfile: makeMain
          }
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Số CCCD hoặc mã BHYT đã tồn tại');
      throw error;
    }
  }
}
