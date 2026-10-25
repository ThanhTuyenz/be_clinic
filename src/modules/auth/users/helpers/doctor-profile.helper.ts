import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { CreateUserDto } from '../dtos/create-user.dto.js';

type ProfileInput = Partial<CreateUserDto>;
type StoredProfile = {
  academicRank: string | null;
  licenseNumber: string | null;
  consultationFee: unknown;
  onlineConsultationFee: unknown;
  isOnlineConsultationEnabled: boolean;
};

export function buildDoctorProfileData(input: ProfileInput, stored?: StoredProfile | null) {
  if (input.consultationFee === null) throw new BadRequestException('Phí khám không được để trống.');
  if (input.experienceYears !== undefined && (!Number.isInteger(input.experienceYears) || input.experienceYears < 0)) {
    throw new BadRequestException('Kinh nghiệm phải là số năm nguyên, không âm.');
  }
  for (const field of ['doctorIsActive', 'isFeatured', 'isOnlineConsultationEnabled'] as const) {
    if (input[field] !== undefined && typeof input[field] !== 'boolean') throw new BadRequestException('Trạng thái bác sĩ phải là giá trị bật hoặc tắt.');
  }
  const academicRank = input.academicRank !== undefined ? input.academicRank?.trim() || null : stored?.academicRank;
  const licenseNumber = input.licenseNumber !== undefined ? input.licenseNumber?.trim() || null : stored?.licenseNumber;
  const consultationFee = input.consultationFee !== undefined ? input.consultationFee : stored?.consultationFee;
  const onlineFee = input.onlineConsultationFee !== undefined ? input.onlineConsultationFee : stored?.onlineConsultationFee;
  const onlineEnabled = input.isOnlineConsultationEnabled ?? stored?.isOnlineConsultationEnabled ?? false;
  if (!stored || input.doctorIsActive === true) {
    if (!academicRank || !licenseNumber) throw new BadRequestException('Vui lòng nhập học hàm / học vị và số CCHN của bác sĩ.');
    if (consultationFee == null) throw new BadRequestException('Vui lòng nhập phí khám của bác sĩ.');
  }
  for (const [name, value] of [['Phí khám', input.consultationFee], ['Phí tư vấn', input.onlineConsultationFee]] as const) {
    if (value != null && (!Number.isFinite(value) || value < 0 || value > 9999999999.99)) {
      throw new BadRequestException(`${name} phải là số từ 0 đến 9.999.999.999,99 VNĐ.`);
    }
  }
  if (onlineEnabled && onlineFee == null && (!stored || input.isOnlineConsultationEnabled === true || input.onlineConsultationFee !== undefined)) {
    throw new BadRequestException('Vui lòng nhập phí tư vấn khi bật nhận tư vấn trực tuyến.');
  }
  return {
    academicRank,
    licenseNumber,
    ...(input.experienceYears !== undefined ? { experienceYears: Number(input.experienceYears) } : {}),
    ...(input.consultationFee !== undefined ? { consultationFee: input.consultationFee } : {}),
    ...(input.onlineConsultationFee !== undefined ? { onlineConsultationFee: input.onlineConsultationFee } : {}),
    ...(input.isOnlineConsultationEnabled !== undefined ? { isOnlineConsultationEnabled: input.isOnlineConsultationEnabled } : {}),
    ...(input.doctorIsActive !== undefined ? { isActive: input.doctorIsActive } : {}),
    ...(input.slotDuration !== undefined ? { slotDuration: input.slotDuration } : {}),
    ...(input.isFeatured !== undefined ? { isFeatured: input.isFeatured } : {}),
    ...(input.biography !== undefined ? { biography: input.biography?.trim() || null } : {}),
    ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl || null } : {}),
  };
}

export async function syncDoctorSpecialties(tx: Prisma.TransactionClient, doctorId: string, input: ProfileInput, creating = false) {
  if (!creating && input.specialtyIds === undefined && input.specialtyId == null && input.primarySpecialtyId === undefined) return;
  const current = input.specialtyIds === undefined && input.specialtyId == null && !creating
    ? await tx.doctorSpecialty.findMany({ where: { doctorId }, select: { specialtyId: true } }) : [];
  const ids = input.specialtyIds ?? (input.specialtyId != null ? [input.specialtyId] : current.map(link => link.specialtyId));
  if (!Array.isArray(ids) || !ids.length || ids.some(id => !Number.isInteger(id) || id < 1) || new Set(ids).size !== ids.length) {
    throw new BadRequestException('Vui lòng chọn ít nhất một chuyên khoa hợp lệ, không trùng lặp.');
  }
  const primaryId = input.primarySpecialtyId ?? input.specialtyId ?? (ids.length === 1 ? ids[0] : undefined);
  if (!primaryId || !ids.includes(primaryId)) throw new BadRequestException('Chuyên khoa chính phải thuộc danh sách chuyên khoa đã chọn.');
  const valid = await tx.specialty.count({ where: { id: { in: ids }, isActive: true } });
  if (valid !== ids.length) throw new BadRequestException('Chuyên khoa không tồn tại hoặc đã ngừng hoạt động.');
  await tx.doctorSpecialty.deleteMany({ where: { doctorId, specialtyId: { notIn: ids } } });
  await tx.doctorSpecialty.updateMany({ where: { doctorId }, data: { isPrimary: false } });
  await tx.doctorSpecialty.createMany({ data: ids.map(specialtyId => ({ doctorId, specialtyId, isPrimary: false })), skipDuplicates: true });
  await tx.doctorSpecialty.update({ where: { doctorId_specialtyId: { doctorId, specialtyId: primaryId } }, data: { isPrimary: true } });
}
