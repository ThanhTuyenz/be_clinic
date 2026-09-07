import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { CreatePatientProfileDto, UpdatePatientProfileDto } from './patient-profiles.dto.js';
import { RecommendationService } from '../recommendations/recommendation.service.js';

@Injectable()
export class PatientProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recommendationService: RecommendationService,
  ) {}

  list(accountId: string) {
    return this.prisma.patientProfile.findMany({ where: { accountId }, orderBy: [{ isMainProfile: 'desc' }, { createdAt: 'asc' }] });
  }

  async create(accountId: string, dto: CreatePatientProfileDto) {
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

        // 2. Tìm xem số CCCD hoặc BHYT này đã từng được cấp Mã bệnh nhân trong hệ thống chưa
        let patientCode: string | null = null;
        if (cleanedNationalId || cleanedHealthInsuranceNumber) {
          const matchedProfile = await tx.patientProfile.findFirst({
            where: {
              OR: [
                ...(cleanedNationalId ? [{ nationalId: cleanedNationalId }] : []),
                ...(cleanedHealthInsuranceNumber ? [{ healthInsuranceNumber: cleanedHealthInsuranceNumber }] : []),
              ],
              patientCode: { not: null },
            },
            select: { patientCode: true },
          });
          if (matchedProfile?.patientCode) {
            patientCode = matchedProfile.patientCode;
          }
        }

        // 3. Nếu chưa từng có trong hệ thống, sinh mã mới tăng dần theo năm (BN26xxxxx)
        if (!patientCode) {
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
          patientCode = `${prefix}${String(seq).padStart(5, '0')}`;
        }

        return tx.patientProfile.create({
          data: {
            accountId,
            patientCode,
            fullName: dto.fullName.trim(),
            dateOfBirth: new Date(`${dto.dateOfBirth}T00:00:00.000Z`),
            gender: dto.gender,
            phoneNumber: dto.phoneNumber?.trim() || null,
            nationalId: cleanedNationalId,
            healthInsuranceNumber: cleanedHealthInsuranceNumber,
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
            medicalHistory: dto.medicalHistory?.trim() || null,
            allergies: dto.allergies?.trim() || null,
            bloodGroup: dto.bloodGroup?.trim() || null,
            height: dto.height !== undefined && dto.height !== null ? Number(dto.height) : null,
            weight: dto.weight !== undefined && dto.weight !== null ? Number(dto.weight) : null,
            relationshipToAccount: dto.relationshipToAccount ?? (makeMain ? 'SELF' : 'OTHER'),
            isMainProfile: makeMain
          }
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

  async update(actorId: string, id: string, dto: UpdatePatientProfileDto, isStaff = false) {
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
      dto.streetAddress !== undefined ? dto.streetAddress?.trim() : profile.streetAddress,
      dto.wardName !== undefined ? dto.wardName?.trim() : profile.wardName,
      dto.districtName !== undefined ? dto.districtName?.trim() : profile.districtName,
      dto.provinceName !== undefined ? dto.provinceName?.trim() : profile.provinceName,
    ].filter(Boolean).join(', ');

    try {
      const updated = await this.prisma.patientProfile.update({
        where: { id },
        data: {
          patientCode: syncedPatientCode,
          ...(dto.fullName && { fullName: dto.fullName.trim() }),
          ...(dto.dateOfBirth && { dateOfBirth: new Date(`${dto.dateOfBirth}T00:00:00.000Z`) }),
          ...(dto.gender !== undefined && { gender: dto.gender }),
          ...(dto.phoneNumber !== undefined && { phoneNumber: dto.phoneNumber?.trim() || null }),
          ...(dto.nationalId !== undefined && { nationalId: effectiveNationalId }),
          ...(dto.healthInsuranceNumber !== undefined && { healthInsuranceNumber: effectiveHealthInsurance }),
          ...(dto.provinceCode !== undefined && { provinceCode: dto.provinceCode?.trim() || null }),
          ...(dto.provinceName !== undefined && { provinceName: dto.provinceName?.trim() || null }),
          ...(dto.districtCode !== undefined && { districtCode: dto.districtCode?.trim() || null }),
          ...(dto.districtName !== undefined && { districtName: dto.districtName?.trim() || null }),
          ...(dto.wardCode !== undefined && { wardCode: dto.wardCode?.trim() || null }),
          ...(dto.wardName !== undefined && { wardName: dto.wardName?.trim() || null }),
          ...(dto.streetAddress !== undefined && { streetAddress: dto.streetAddress?.trim() || null }),
          ...(computedAddress ? { address: computedAddress } : {}),
          ...(dto.ethnicity !== undefined && { ethnicity: dto.ethnicity?.trim() || null }),
          ...(dto.nationality !== undefined && { nationality: dto.nationality?.trim() || null }),
          ...(dto.occupation !== undefined && { occupation: dto.occupation?.trim() || null }),
          ...(dto.guardianName !== undefined && { guardianName: dto.guardianName?.trim() || null }),
          ...(dto.guardianPhone !== undefined && { guardianPhone: dto.guardianPhone?.trim() || null }),
          ...(dto.guardianRelationship !== undefined && { guardianRelationship: dto.guardianRelationship?.trim() || null }),
          ...(dto.medicalHistory !== undefined && { medicalHistory: dto.medicalHistory?.trim() || null }),
          ...(dto.allergies !== undefined && { allergies: dto.allergies?.trim() || null }),
          ...(dto.bloodGroup !== undefined && { bloodGroup: dto.bloodGroup?.trim() || null }),
          ...(dto.height !== undefined && { height: dto.height !== null ? Number(dto.height) : null }),
          ...(dto.weight !== undefined && { weight: dto.weight !== null ? Number(dto.weight) : null }),
          ...(dto.relationshipToAccount !== undefined && { relationshipToAccount: dto.relationshipToAccount }),
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
    const isStaff = user && ['ADMIN', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'RECEPTIONIST', 'DOCTOR'].includes(user.role);
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
            method: appt.invoice.payments?.[0]?.method || 'MoMo',
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
        profile: {
          id: profile.id,
          patientCode: profile.patientCode,
          fullName: profile.fullName,
          dateOfBirth: profile.dateOfBirth,
          gender: profile.gender,
          phoneNumber: profile.phoneNumber,
          nationalId: profile.nationalId,
          healthInsuranceNumber: profile.healthInsuranceNumber,
          address: profile.address,
          provinceName: profile.provinceName,
          districtName: profile.districtName,
          wardName: profile.wardName,
          streetAddress: profile.streetAddress,
          ethnicity: profile.ethnicity,
          nationality: profile.nationality,
          occupation: profile.occupation,
          guardianName: profile.guardianName,
          guardianPhone: profile.guardianPhone,
          guardianRelationship: profile.guardianRelationship,
          relationshipToAccount: profile.relationshipToAccount,
          isMainProfile: profile.isMainProfile,
          medicalHistory: profile.medicalHistory,
          allergies: profile.allergies,
          bloodGroup: profile.bloodGroup,
          height: profile.height,
          weight: profile.weight,
        },
        visits,
      },
    };
  }
}
