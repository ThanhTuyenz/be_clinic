import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { RecommendationService } from '../recommendations/recommendation.service.js';
import { resolvePatientCode } from './patient-code.js';
import {
CreatePatientProfileDto,
PatientProfileResponseDto,
UpdatePatientProfileDto,
} from './patient-profiles.dto.js';

@Injectable()
export class PatientProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recommendationService: RecommendationService,
  ) {}

  async list(accountId: string): Promise<PatientProfileResponseDto[]> {
    return this.prisma.patientProfile.findMany({
      where: { accountId },
      orderBy: [{ isMainProfile: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async create(accountId: string, dto: CreatePatientProfileDto): Promise<PatientProfileResponseDto> {
    const dob = new Date(`${dto.dateOfBirth}T00:00:00.000Z`);
    const ageDiffMs = Date.now() - dob.getTime();
    const age = Math.abs(new Date(ageDiffMs).getUTCFullYear() - 1970);
    if (age >= 15 && !dto.nationalId?.trim()) {
      throw new BadRequestException('Bệnh nhân từ 15 tuổi trở lên bắt buộc phải có số CCCD / Hộ chiếu.');
    }

    const cleanedNationalId = dto.nationalId?.trim() || null;
    const cleanedHealthInsuranceNumber = dto.healthInsuranceNumber?.trim() || null;

    // 1. Kiểm tra trùng trong chính tài khoản này
    if (cleanedNationalId || cleanedHealthInsuranceNumber) {
      const existingInSameAccount = await this.prisma.patientProfile.findFirst({
        where: {
          accountId,
          OR: [
            ...(cleanedNationalId ? [{ nationalId: cleanedNationalId }] : []),
            ...(cleanedHealthInsuranceNumber ? [{ healthInsuranceNumber: cleanedHealthInsuranceNumber }] : []),
          ],
        },
      });
      if (existingInSameAccount) {
        throw new ConflictException('Hồ sơ với số CCCD hoặc mã BHYT này đã tồn tại trong tài khoản của bạn.');
      }
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const count = await tx.patientProfile.count({ where: { accountId } });
        const makeMain = dto.isMainProfile === true || count === 0;
        if (makeMain) await tx.patientProfile.updateMany({ where: { accountId, isMainProfile: true }, data: { isMainProfile: false } });

        const computedAddress = dto.address?.trim() || [
          dto.streetAddress?.trim(),
          dto.wardName?.trim(),
          dto.districtName?.trim(),
          dto.provinceName?.trim()
        ].filter(Boolean).join(', ');

        const patientCode = await resolvePatientCode(tx, cleanedNationalId, cleanedHealthInsuranceNumber);

        return tx.patientProfile.create({
          data: {
            ...dto,
            accountId,
            patientCode,
            fullName: dto.fullName.trim(),
            dateOfBirth: new Date(`${dto.dateOfBirth}T00:00:00.000Z`),
            nationalId: cleanedNationalId,
            healthInsuranceNumber: cleanedHealthInsuranceNumber,
            address: computedAddress || null,
            relationshipToAccount: dto.relationshipToAccount ?? (makeMain ? 'SELF' : 'OTHER'),
            isMainProfile: makeMain,
          },
        });
      });
      this.recommendationService.triggerAsyncRecommendation(created.id);
      return created;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Hồ sơ với số CCCD hoặc mã BHYT này đã tồn tại trong tài khoản của bạn.');
      }
      throw error;
    }
  }

  async update(actorId: string, id: string, dto: UpdatePatientProfileDto, isStaff = false): Promise<PatientProfileResponseDto> {
    const profile = isStaff
      ? await this.prisma.patientProfile.findUnique({ where: { id } })
      : await this.prisma.patientProfile.findFirst({ where: { id, accountId: actorId } });
    if (!profile) throw new NotFoundException('Không tìm thấy hồ sơ bệnh nhân');

    const accountId = profile.accountId;
    const effectiveDob = dto.dateOfBirth ? new Date(`${dto.dateOfBirth}T00:00:00.000Z`) : profile.dateOfBirth;
    const effectiveNationalId = dto.nationalId !== undefined ? dto.nationalId?.trim() || null : profile.nationalId;
    const effectiveHealthInsurance = dto.healthInsuranceNumber !== undefined ? dto.healthInsuranceNumber?.trim() || null : profile.healthInsuranceNumber;

    if (effectiveDob) {
      const ageDiffMs = Date.now() - effectiveDob.getTime();
      const age = Math.abs(new Date(ageDiffMs).getUTCFullYear() - 1970);
      if (age >= 15 && !effectiveNationalId) {
        throw new BadRequestException('Bệnh nhân từ 15 tuổi trở lên bắt buộc phải có số CCCD / Hộ chiếu.');
      }
    }

    // Kiểm tra trùng lặp trong cùng tài khoản (nếu có accountId)
    if (accountId && (effectiveNationalId || effectiveHealthInsurance)) {
      const dup = await this.prisma.patientProfile.findFirst({
        where: {
          accountId,
          id: { not: id },
          OR: [
            ...(effectiveNationalId ? [{ nationalId: effectiveNationalId }] : []),
            ...(effectiveHealthInsurance ? [{ healthInsuranceNumber: effectiveHealthInsurance }] : []),
          ],
        },
      });
      if (dup) throw new ConflictException('Hồ sơ với số CCCD hoặc mã BHYT này đã tồn tại trong tài khoản của bệnh nhân.');
    }

    // Đồng bộ patientCode nếu CCCD mới đã từng có mã trên hệ thống
    let syncedPatientCode = profile.patientCode;
    if (effectiveNationalId || effectiveHealthInsurance) {
      const matched = await this.prisma.patientProfile.findFirst({
        where: {
          id: { not: id },
          OR: [
            ...(effectiveNationalId ? [{ nationalId: effectiveNationalId }] : []),
            ...(effectiveHealthInsurance ? [{ healthInsuranceNumber: effectiveHealthInsurance }] : []),
          ],
          patientCode: { not: null },
        },
        select: { patientCode: true },
      });
      if (matched?.patientCode) {
        syncedPatientCode = matched.patientCode;
      }
    }

    const computedAddress = dto.address?.trim() || [
      dto.streetAddress !== undefined ? dto.streetAddress?.trim() || null : profile.streetAddress,
      dto.wardName !== undefined ? dto.wardName?.trim() || null : profile.wardName,
      dto.districtName !== undefined ? dto.districtName?.trim() || null : profile.districtName,
      dto.provinceName !== undefined ? dto.provinceName?.trim() || null : profile.provinceName,
    ].filter(Boolean).join(', ');

    try {
      const updated = await this.prisma.patientProfile.update({
        where: { id },
        data: {
          ...dto,
          patientCode: syncedPatientCode,
          ...(dto.fullName && { fullName: dto.fullName.trim() }),
          ...(dto.dateOfBirth && { dateOfBirth: new Date(`${dto.dateOfBirth}T00:00:00.000Z`) }),
          ...(dto.nationalId !== undefined && { nationalId: effectiveNationalId }),
          ...(dto.healthInsuranceNumber !== undefined && { healthInsuranceNumber: effectiveHealthInsurance }),
          ...(computedAddress ? { address: computedAddress } : {}),
        },
      });
      await this.recommendationService.invalidateCache(id);
      this.recommendationService.triggerAsyncRecommendation(id);
      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Hồ sơ với số CCCD hoặc mã BHYT này đã tồn tại trong tài khoản của bạn.');
      }
      throw error;
    }
  }

  async getMedicalRecord(userId: string, patientProfileId: string) {
    if (!patientProfileId) throw new BadRequestException('Thiếu mã hồ sơ bệnh nhân');

    const profile = await this.prisma.patientProfile.findUnique({
      where: { id: patientProfileId },
    });
    if (!profile) throw new NotFoundException('Không tìm thấy hồ sơ bệnh nhân');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    const isStaff = user && ['CHAIN_MANAGER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'RECEPTIONIST', 'DOCTOR'].includes(user.role);
    if (!isStaff && profile.accountId !== userId) {
      throw new ForbiddenException('Không có quyền truy cập hồ sơ bệnh án này');
    }

    const appointments = await this.prisma.appointment.findMany({
      where: {
        OR: [
          { patientProfileId: profile.id },
          ...(profile.nationalId ? [{ patientProfile: { nationalId: profile.nationalId } }] : []),
          ...(profile.patientCode ? [{ patientProfile: { patientCode: profile.patientCode } }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        bookingCode: true,
        createdAt: true,
        status: true,
        symptomsDescription: true,
        queueNumber: true,
        branch: { select: { id: true, name: true, address: true } },
        servicePackage: { select: { id: true, name: true, code: true, price: true } },
        scheduleSlot: {
          select: {
            startTime: true,
            endTime: true,
            schedule: {
              select: {
                workDate: true,
                room: { select: { code: true, name: true } },
                branch: { select: { id: true, name: true, address: true } },
                doctor: {
                  select: {
                    id: true,
                    academicRank: true,
                    user: { select: { fullName: true } },
                  },
                },
              },
            },
          },
        },
        invoice: {
          select: {
            status: true,
            totalAmount: true,
            payments: {
              select: { method: true },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
      },
    });

    const visits = appointments.map((appt) => {
      const slot = appt.scheduleSlot;
      const doc = slot?.schedule?.doctor;
      const docUser = doc?.user;
      const branch = slot?.schedule?.branch || appt.branch;
      const room = slot?.schedule?.room;
      const apptDate = slot?.schedule?.workDate
        ? slot.schedule.workDate.toISOString().slice(0, 10)
        : appt.createdAt.toISOString().slice(0, 10);
      const startTime = slot?.startTime ? slot.startTime.toISOString().slice(11, 16) : null;
      const endTime = slot?.endTime ? slot.endTime.toISOString().slice(11, 16) : null;

      const isCompleted = ['COMPLETED', 'FINISHED'].includes(appt.status);

      return {
        id: appt.id,
        visitCode: appt.bookingCode || `KB-${appt.id.slice(0, 8).toUpperCase()}`,
        createdAt: appt.createdAt.toISOString(),
        status: appt.status,
        reasonForVisit: appt.symptomsDescription || appt.servicePackage?.name || 'Khám chuyên khoa',
        preliminaryDiagnosis: appt.symptomsDescription
          ? `Triệu chứng ghi nhận: ${appt.symptomsDescription}`
          : (appt.servicePackage?.name ? `Chẩn đoán sơ bộ theo gói ${appt.servicePackage.name}` : null),
        finalDiagnosis: isCompleted
          ? (appt.servicePackage?.name ? `Khám chuyên khoa: ${appt.servicePackage.name} - Đã có kết luận lâm sàng` : 'Hoàn thành khám lâm sàng')
          : null,
        treatmentPlan: isCompleted
          ? 'Tuân thủ đơn thuốc và hướng dẫn chăm sóc y tế của bác sĩ phụ trách.'
          : null,
        notes: appt.symptomsDescription ? `Ghi chú tiếp nhận: ${appt.symptomsDescription}` : null,
        appointment: {
          id: appt.id,
          appointmentDate: apptDate,
          startTime,
          endTime,
          status: appt.status,
          queueNumber: appt.queueNumber,
          doctor: doc ? {
            id: doc.id,
            fullName: docUser?.fullName || 'Bác sĩ chuyên khoa',
            academicRank: doc.academicRank || 'BS.',
          } : null,
          branch: branch ? {
            id: branch.id,
            name: branch.name,
            address: branch.address,
          } : null,
          servicePackage: appt.servicePackage ? {
            id: appt.servicePackage.id,
            name: appt.servicePackage.name,
            code: appt.servicePackage.code,
            price: Number(appt.servicePackage.price),
          } : null,
          scheduleSlot: slot ? {
            schedule: {
              room: room ? { code: room.code, name: room.name } : null,
            },
          } : null,
          payment: appt.invoice ? {
            status: appt.invoice.status,
            amount: Number(appt.invoice.totalAmount),
            method: appt.invoice.payments?.[0]?.method || 'ONLINE',
          } : null,
        },
      };
    });

    return {
      medicalRecord: {
        id: profile.id,
        recordCode: profile.patientCode || `BN${profile.id.slice(0, 8).toUpperCase()}`,
        allergies: profile.allergies || null,
        medicalHistory: profile.medicalHistory || null,
        bloodGroup: profile.bloodGroup || null,
        height: profile.height || null,
        weight: profile.weight || null,
        surgicalHistory: null,
        familyHistory: null,
        notes: null,
        profile: { ...profile },
        visits,
      },
    };
  }
}
