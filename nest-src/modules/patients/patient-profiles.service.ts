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
        return tx.patientProfile.create({ data: { accountId, fullName: dto.fullName.trim(), dateOfBirth: new Date(`${dto.dateOfBirth}T00:00:00.000Z`), gender: dto.gender, nationalId: dto.nationalId?.trim() || null, address: dto.address?.trim(), relationshipToAccount: dto.relationshipToAccount ?? (makeMain ? 'SELF' : 'OTHER'), isMainProfile: makeMain } });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('CCCD/định danh đã tồn tại');
      throw error;
    }
  }
}
