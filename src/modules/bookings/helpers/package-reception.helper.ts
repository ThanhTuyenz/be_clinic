import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CLINIC_SESSION_WINDOWS } from '../../../common/constants/clinic-sessions.js';

export const PACKAGE_RECEPTION_SELECT = {
  receptionSchedules: { select: { branchId: true, dayOfWeek: true, sessions: true } },
  id: true,
  name: true,
  price: true,
  isActive: true,
  specialtyId: true,
  branchBookingMethod: {
    select: { branchId: true, bookingMethodId: true, isEnabled: true },
  },
  branchBookingMethods: {
    select: {
      branchBookingMethod: {
        select: { branchId: true, bookingMethodId: true, isEnabled: true },
      },
    },
  },
} satisfies Prisma.ServicePackageSelect;

export type ReceptionSession = keyof typeof CLINIC_SESSION_WINDOWS;
export type ReceptionDay = { branchId: string; dayOfWeek: number; sessions: readonly string[] };

export function assertReceptionMethods(
  methods: readonly { branchId: string; bookingMethod: { code: string } }[],
  days: readonly ReceptionDay[],
): void {
  for (const day of days) {
    const codes = methods.filter((method) => method.branchId === day.branchId).map((method) => method.bookingMethod.code);
    if (codes.length && codes.every((code) => code === 'AFTER_HOURS') && day.dayOfWeek !== 6 && day.dayOfWeek !== 0) {
      throw new BadRequestException('Gói chỉ triển khai khám ngoài giờ tại chi nhánh này. Lịch tiếp nhận phải vào thứ Bảy hoặc Chủ nhật.');
    }
  }
}

// The last slot must start before closing; 17:00 belongs to the evening session.
export function packageAcceptsSlot(
  schedules: readonly ReceptionDay[], branchId: string, workDate: Date, startTime: Date,
): boolean {
  const time = startTime.toISOString().slice(11, 16);
  return schedules.some((day) => day.branchId === branchId && day.dayOfWeek === workDate.getUTCDay()
    && day.sessions.some((session) => {
      const window = CLINIC_SESSION_WINDOWS[session as ReceptionSession];
      return window && time >= window.start && time < window.end;
    }));
}

export function bookingMethodAcceptsSlot(code: string | undefined, slot: { schedule: { workDate: Date } }): boolean {
  if (code !== 'AFTER_HOURS') return true;
  const day = slot.schedule.workDate.getUTCDay();
  return day === 6 || day === 0;
}

export function assertBookingMethodSlot(code: string, slot: { schedule: { workDate: Date } }): void {
  if (!bookingMethodAcceptsSlot(code, slot)) {
    throw new BadRequestException('Khám ngoài giờ chỉ nhận lịch vào thứ Bảy và Chủ nhật. Vui lòng chọn lại ngày khám.');
  }
}

export function assertPackageReception(
  schedules: readonly ReceptionDay[],
  slot: { startTime: Date; schedule: { branchId: string; workDate: Date } },
): void {
  if (!packageAcceptsSlot(schedules, slot.schedule.branchId, slot.schedule.workDate, slot.startTime)) {
    throw new BadRequestException('Khung giờ đã chọn nằm ngoài lịch tiếp nhận của gói khám tại chi nhánh. Vui lòng chọn lại.');
  }
}

export function parseReceptionDays(value: unknown): { dayOfWeek: number; sessions: ReceptionSession[] }[] {
  if (!Array.isArray(value) || value.length > 7) {
    throw new BadRequestException('Lịch tiếp nhận phải là danh sách tối đa 7 ngày.');
  }
  const seen = new Set<number>();
  return value.map((day) => {
    if (!day || !Number.isInteger(day.dayOfWeek) || day.dayOfWeek < 0 || day.dayOfWeek > 6 || seen.has(day.dayOfWeek)) {
      throw new BadRequestException('Ngày tiếp nhận phải từ 0 đến 6 và không được trùng.');
    }
    seen.add(day.dayOfWeek);
    if (!Array.isArray(day.sessions) || !day.sessions.length
      || day.sessions.some((session: unknown) => typeof session !== 'string' || !Object.hasOwn(CLINIC_SESSION_WINDOWS, session))) {
      throw new BadRequestException('Mỗi ngày tiếp nhận cần chọn ít nhất một buổi sáng, chiều hoặc tối.');
    }
    return { dayOfWeek: day.dayOfWeek, sessions: [...new Set<ReceptionSession>(day.sessions)] };
  });
}

export function parseBranchReceptionSchedules(value: unknown, branchIds: readonly string[]): { branchId: string; dayOfWeek: number; sessions: ReceptionSession[] }[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new BadRequestException('Lịch tiếp nhận theo cơ sở không hợp lệ.');
  const seen = new Set<string>();
  return value.flatMap((entry) => {
    if (!entry || typeof entry.branchId !== 'string' || !branchIds.includes(entry.branchId) || seen.has(entry.branchId)) {
      throw new BadRequestException('Lịch tiếp nhận phải thuộc cơ sở áp dụng và không được trùng cơ sở.');
    }
    seen.add(entry.branchId);
    return parseReceptionDays(entry.schedules).map((day) => ({ ...day, branchId: entry.branchId }));
  });
}
