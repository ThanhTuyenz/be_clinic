import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';

/**
 * Resolve Branch ID từ chuỗi UUID, slug hoặc code
 */
export async function resolveBranchId(
  prisma: PrismaService,
  identifier?: string,
): Promise<string | undefined> {
  if (!identifier) return undefined;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier)) {
    return identifier;
  }
  const branch = await prisma.branch.findFirst({
    where: { OR: [{ slug: identifier }, { code: identifier }], isActive: true },
    select: { id: true },
  });
  return branch?.id ?? identifier;
}

/**
 * Tính toán dải ngày được phép đặt khám trực tuyến (+7 VN Timezone, 16h30 Cutoff, 1-30 ngày)
 */
export function getBookingAllowedDateRange(): { minDate: Date; maxDate: Date } {
  const nowUtc = new Date();
  const vnOffsetMs = 7 * 60 * 60 * 1000;
  const nowVn = new Date(nowUtc.getTime() + vnOffsetMs);
  const currentHour = nowVn.getUTCHours();
  const currentMinute = nowVn.getUTCMinutes();
  const todayVnStr = nowVn.toISOString().slice(0, 10);
  const baseDate = new Date(`${todayVnStr}T00:00:00.000Z`);

  const isPastCutoff = currentHour > 16 || (currentHour === 16 && currentMinute >= 30);
  const minDays = isPastCutoff ? 2 : 1;

  const minDate = new Date(baseDate);
  minDate.setUTCDate(minDate.getUTCDate() + minDays);

  const maxDate = new Date(baseDate);
  maxDate.setUTCDate(maxDate.getUTCDate() + 30);

  return { minDate, maxDate };
}

/**
 * Xác thực ngày khám có nằm trong khoảng hợp lệ của hệ thống đặt khám trực tuyến
 */
export function validateDateWithinBookingRange(targetDate: Date): void {
  const nowUtc = new Date();
  const vnOffsetMs = 7 * 60 * 60 * 1000;
  const nowVn = new Date(nowUtc.getTime() + vnOffsetMs);
  const currentHour = nowVn.getUTCHours();
  const currentMinute = nowVn.getUTCMinutes();

  const todayVnStr = nowVn.toISOString().slice(0, 10);
  const baseDate = new Date(`${todayVnStr}T00:00:00.000Z`);
  const examDateStr = targetDate.toISOString().slice(0, 10);
  const examDateOnly = new Date(`${examDateStr}T00:00:00.000Z`);

  const diffDays = Math.round((examDateOnly.getTime() - baseDate.getTime()) / (24 * 60 * 60 * 1000));

  if (diffDays < 1) {
    throw new NotFoundException(
      'Hệ thống không nhận đặt lịch trực tuyến trong ngày. Để khám trong ngày hôm nay, quý khách vui lòng đến trực tiếp phòng khám để lấy số thứ tự tại quầy tiếp đón.',
    );
  }
  if (diffDays > 30) {
    throw new NotFoundException('Hệ thống chỉ mở đặt lịch trực tuyến trước tối đa 30 ngày.');
  }
  if (diffDays === 1) {
    const isPastCutoff = currentHour > 16 || (currentHour === 16 && currentMinute >= 30);
    if (isPastCutoff) {
      throw new NotFoundException(
        'Để khám vào ngày mai, quý khách vui lòng hoàn tất đặt lịch trước 16h30 hôm nay. Quý khách vui lòng chọn ngày khám khác hoặc đến lấy số trực tiếp tại quầy tiếp đón.',
      );
    }
  }
}
