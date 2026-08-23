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

        return tx.patientProfile.create({
          data: {
            accountId,
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
