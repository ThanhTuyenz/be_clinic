import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { parseDate as parseDateUtil } from '../../common/utils/staff.utils.js';
import {
  getBookingAllowedDateRange,
  resolveBranchId,
  validateDateWithinBookingRange,
} from '../../common/utils/booking-date-rules.utils.js';

@Injectable()
export class PackageSchedulesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Giải quyết thông tin cơ bản của gói dịch vụ: branchId, specialtyId, sessionType, activeDays
   */
  private async resolvePackageContext(packageIdentifier: string, branchIdentifier?: string) {
    const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(packageIdentifier);

    const servicePackage = await this.prisma.servicePackage.findFirst({
      where: isId ? { id: packageIdentifier } : { OR: [{ slug: packageIdentifier }, { code: packageIdentifier }] },
      select: {
        id: true,
        specialtyId: true,
        sessionType: true,
        activeDaysOfWeek: true,
        branchBookingMethod: { select: { branchId: true } },
        branchBookingMethods: { select: { branchBookingMethod: { select: { branchId: true } } } },
      },
    });

    if (!servicePackage) throw new NotFoundException('Không tìm thấy gói dịch vụ');

    const resolvedBranchId = branchIdentifier ? await resolveBranchId(this.prisma, branchIdentifier) : null;
    const branchId =
      resolvedBranchId ||
      servicePackage.branchBookingMethods?.[0]?.branchBookingMethod?.branchId ||
      servicePackage.branchBookingMethod?.branchId;

    if (!branchId) throw new NotFoundException('Không tìm thấy cơ sở y tế cho gói khám này');

    const specialtyId = servicePackage.specialtyId;
    const sessionType = (servicePackage as any).sessionType || 'ALL_DAY';
    const activeDays: number[] = (servicePackage as any).activeDaysOfWeek?.length
      ? (servicePackage as any).activeDaysOfWeek
      : [0, 1, 2, 3, 4, 5, 6];

    return { branchId, specialtyId, sessionType, activeDays };
  }

  /**
   * Lấy danh sách các ngày khả dụng cho gói dịch vụ
   */
  async getPackageScheduleDates(packageIdentifier: string, branchIdentifier?: string) {
    if (!packageIdentifier) throw new NotFoundException('Thiếu gói dịch vụ');
    const { branchId, specialtyId, sessionType, activeDays } = await this.resolvePackageContext(packageIdentifier, branchIdentifier);

    const { minDate, maxDate } = getBookingAllowedDateRange();
    const rows = await this.prisma.doctorSchedule.findMany({
      where: {
        branchId,
        status: 'OPEN',
        workDate: { gte: minDate, lte: maxDate },
        ...(specialtyId ? { doctor: { specialties: { some: { specialtyId } } } } : {}),
        slots: { some: { isActive: true, slotStatus: 'AVAILABLE' } },
      },
      select: {
        workDate: true,
        slots: {
          where: { isActive: true, slotStatus: 'AVAILABLE' },
          select: { startTime: true },
        },
      },
      orderBy: { workDate: 'asc' },
      take: 90,
    });

    const dateSet = new Set<string>();
    for (const row of rows) {
      const dayOfWeek = row.workDate.getDay();
      if (!activeDays.includes(dayOfWeek)) continue;

      const dateStr = row.workDate.toISOString().slice(0, 10);
      if (sessionType === 'MORNING') {
        const hasMorningSlot = row.slots.some((s) => s.startTime.toISOString().slice(11, 16) < '12:00');
        if (hasMorningSlot) dateSet.add(dateStr);
      } else if (sessionType === 'AFTERNOON') {
        const hasAfternoonSlot = row.slots.some((s) => {
          const t = s.startTime.toISOString().slice(11, 16);
          return t >= '12:00' && t < '17:00';
        });
        if (hasAfternoonSlot) dateSet.add(dateStr);
      } else if (sessionType === 'EVENING') {
        const hasEveningSlot = row.slots.some((s) => s.startTime.toISOString().slice(11, 16) >= '17:00');
        if (hasEveningSlot) dateSet.add(dateStr);
      } else if (sessionType === 'OFFICE_HOURS') {
        const hasOfficeSlot = row.slots.some((s) => s.startTime.toISOString().slice(11, 16) < '17:00');
        if (hasOfficeSlot) dateSet.add(dateStr);
      } else {
        if (row.slots.length > 0) dateSet.add(dateStr);
      }
    }
    return Array.from(dateSet);
  }

  /**
   * Lấy danh sách khung giờ khả dụng cho gói dịch vụ theo ngày
   */
  async getPackageTimeslots(packageIdentifier: string, date: string, branchIdentifier?: string) {
    if (!packageIdentifier) throw new NotFoundException('Thiếu gói dịch vụ');
    const { branchId, specialtyId, sessionType, activeDays } = await this.resolvePackageContext(packageIdentifier, branchIdentifier);

    const workDate = parseDateUtil(date) ?? new Date(`${date}T00:00:00.000Z`);
    validateDateWithinBookingRange(workDate);

    if (!activeDays.includes(workDate.getDay())) {
      return [];
    }

    const rows = await this.prisma.doctorScheduleSlot.findMany({
      where: {
        isActive: true,
        slotStatus: 'AVAILABLE',
        schedule: {
          branchId,
          workDate,
          status: 'OPEN',
          ...(specialtyId ? { doctor: { specialties: { some: { specialtyId } } } } : {}),
        },
      },
      orderBy: { startTime: 'asc' },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        capacity: true,
        occupiedCount: true,
        slotStatus: true,
        schedule: {
          select: {
            room: { select: { id: true, code: true, name: true } },
            doctor: {
              select: { id: true, academicRank: true, user: { select: { fullName: true } } },
            },
          },
        },
      },
    });

    const slotMap = new Map<string, any>();
    for (const slot of rows) {
      const { schedule } = slot as any;
      const start = slot.startTime.toISOString().slice(11, 16);
      const end = slot.endTime.toISOString().slice(11, 16);

      if (sessionType === 'MORNING' && start >= '12:00') continue;
      if (sessionType === 'AFTERNOON' && (start < '12:00' || start >= '17:00')) continue;
      if (sessionType === 'EVENING' && start < '17:00') continue;
      if (sessionType === 'OFFICE_HOURS' && start >= '17:00') continue;

      const key = `${start}-${end}`;
      const docName = schedule.doctor?.academicRank
        ? `${schedule.doctor.academicRank} ${schedule.doctor.user?.fullName || ''}`.trim()
        : schedule.doctor?.user?.fullName || 'Bác sĩ trực khám';

      const isAvail = slot.slotStatus === 'AVAILABLE' && slot.capacity - slot.occupiedCount > 0;
      const rem = Math.max(0, slot.capacity - slot.occupiedCount);

      if (!slotMap.has(key)) {
        slotMap.set(key, {
          id: slot.id,
          doctorSlotId: slot.id,
          startTime: start,
          endTime: end,
          label: `${start} - ${end}`,
          capacity: slot.capacity,
          occupiedCount: slot.occupiedCount,
          remainingCapacity: rem,
          isAvailable: isAvail,
          doctor: schedule.doctor ? { id: schedule.doctor.id, fullName: docName } : null,
          doctorId: schedule.doctor?.id,
          room: schedule.room,
        });
      } else {
        const existing = slotMap.get(key);
        existing.capacity += slot.capacity;
        existing.occupiedCount += slot.occupiedCount;
        existing.remainingCapacity += rem;
        existing.isAvailable = existing.isAvailable || isAvail;
        if (existing.remainingCapacity <= rem && isAvail) {
          existing.id = slot.id;
          existing.doctorSlotId = slot.id;
          if (schedule.doctor) {
            existing.doctor = { id: schedule.doctor.id, fullName: docName };
            existing.doctorId = schedule.doctor.id;
          }
        }
      }
    }

    return Array.from(slotMap.values());
  }
}
