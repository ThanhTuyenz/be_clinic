import { RECEPTION_SLOT_LOCATION_SELECT, appointmentBranch } from '../appointments/helpers/appointment-branch.helper.js';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isISO8601 } from 'class-validator';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { RecommendationService } from '../recommendations/recommendation.service.js';
import { resolvePatientCode } from './patient-code.js';
import { patientRecordScope } from './patient-record-scope.js';
import { formatPatientAddress, normalizePatientAddressInput } from './patient-address.js';
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

  private parseDateOfBirth(value: string): Date {
    const input = typeof value === 'string' ? value.trim() : '';
    if (!/^\d{4}-\d{2}-\d{2}(?:T.+)?$/.test(input) || !isISO8601(input, { strict: true, strictSeparator: true })) {
      throw new BadRequestException('Ngày sinh không hợp lệ. Vui lòng chọn lại ngày sinh.');
    }
    // Birth dates are calendar dates; preserve the supplied day even for ISO timestamps.
    const dateOnly = input.slice(0, 10);
    const date = new Date(`${dateOnly}T00:00:00.000Z`);
    const today = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== dateOnly || dateOnly > today) {
      throw new BadRequestException('Ngày sinh không hợp lệ hoặc lớn hơn ngày hiện tại.');
    }
    return date;
  }

  async list(accountId: string): Promise<PatientProfileResponseDto[]> {
    const profiles = await this.prisma.patientProfile.findMany({
      where: { accountId },
      orderBy: [{ isMainProfile: 'desc' }, { createdAt: 'asc' }],
    });
    return profiles.map((profile) => ({ ...profile, address: formatPatientAddress(profile) }));
  }

  async create(accountId: string, dto: CreatePatientProfileDto): Promise<PatientProfileResponseDto> {
    if (dto.gender !== 'FEMALE') {
      dto.pregnancyStatus = null;
      dto.isBreastfeeding = null;
    }
    const dob = this.parseDateOfBirth(dto.dateOfBirth);
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

        const patientCode = await resolvePatientCode(tx, cleanedNationalId, cleanedHealthInsuranceNumber);

        return tx.patientProfile.create({
          data: {
            ...normalizePatientAddressInput(dto),
            accountId,
            patientCode,
            fullName: dto.fullName.trim(),
            dateOfBirth: dob,
            nationalId: cleanedNationalId,
            healthInsuranceNumber: cleanedHealthInsuranceNumber,
            relationshipToAccount: dto.relationshipToAccount ?? (makeMain ? 'SELF' : 'OTHER'),
            isMainProfile: makeMain,
          },
        });
      });
      this.recommendationService.triggerAsyncRecommendation(created.id);
      return { ...created, address: formatPatientAddress(created) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Hồ sơ với số CCCD hoặc mã BHYT này đã tồn tại trong tài khoản của bạn.');
      }
      throw error;
    }
  }

  async update(actorId: string, id: string, dto: UpdatePatientProfileDto, isStaff = false): Promise<PatientProfileResponseDto> {
    const dob = dto.dateOfBirth !== undefined ? this.parseDateOfBirth(dto.dateOfBirth) : undefined;
    const profile = isStaff
      ? await this.prisma.patientProfile.findUnique({ where: { id } })
      : await this.prisma.patientProfile.findFirst({ where: { id, accountId: actorId } });
    if (!profile) throw new NotFoundException('Không tìm thấy hồ sơ bệnh nhân');
    if ((dto.gender ?? profile.gender) !== 'FEMALE') {
      dto.pregnancyStatus = null;
      dto.isBreastfeeding = null;
    }

    const accountId = profile.accountId;
    const effectiveDob = dob ?? profile.dateOfBirth;
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

    try {
      const updated = await this.prisma.patientProfile.update({
        where: { id },
        data: {
          ...normalizePatientAddressInput(dto, profile),
          patientCode: syncedPatientCode,
          ...(dto.fullName && { fullName: dto.fullName.trim() }),
          ...(dob !== undefined && { dateOfBirth: dob }),
          ...(dto.nationalId !== undefined && { nationalId: effectiveNationalId }),
          ...(dto.healthInsuranceNumber !== undefined && { healthInsuranceNumber: effectiveHealthInsurance }),
        },
      });
      await this.recommendationService.invalidateCache(id);
      this.recommendationService.triggerAsyncRecommendation(id);
      return { ...updated, address: formatPatientAddress(updated) };
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

    const recordScope = await patientRecordScope(this.prisma, userId, profile);

    const appointments = await this.prisma.appointment.findMany({
      where: recordScope,
      orderBy: { createdAt: 'desc' },
      select: {
        receptionSlot: { select: { ...RECEPTION_SLOT_LOCATION_SELECT, date: true, startTime: true, endTime: true } },
        id: true,
        bookingCode: true,
        createdAt: true,
        status: true,
        symptomsDescription: true,
        queueNumber: true,
        servicePackage: { select: { id: true, name: true, code: true, price: true } },
        scheduleSlot: {
          select: {
            startTime: true,
            endTime: true,
            schedule: {
              select: { branchId: true,
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
        bookingOrder: { select: { invoice: {
          select: {
            status: true,
            totalAmount: true,
            payments: {
              select: { method: true },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        } } },
      },
    });

    const visits = appointments.map((appt) => {
      const slot = appt.scheduleSlot;
      const doc = slot?.schedule?.doctor;
      const docUser = doc?.user;
      const branch = slot?.schedule?.branch || appointmentBranch(appt);
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
          payment: appt.bookingOrder.invoice ? {
            status: appt.bookingOrder.invoice.status,
            amount: Number(appt.bookingOrder.invoice.totalAmount),
            method: appt.bookingOrder.invoice.payments?.[0]?.method || 'ONLINE',
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
        familyHistory: profile.familyHistory || null,
        notes: null,
        profile: { ...profile, address: formatPatientAddress(profile) },
        visits,
      },
    };
  }
}
