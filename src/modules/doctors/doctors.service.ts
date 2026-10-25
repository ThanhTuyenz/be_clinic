import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { isUuid, parseDate as parseDateUtil, parseDateRange } from '../../common/utils/staff.utils.js';

@Injectable()
export class DoctorsService {
  constructor(private readonly prisma: PrismaService) { }


  private async resolveBranchId(identifier?: string): Promise<string | undefined> {
    if (!identifier) return undefined;
    if (isUuid(identifier)) return identifier;
    const branch = await this.prisma.branch.findFirst({
      where: { OR: [{ slug: identifier }, { code: identifier }], isActive: true },
      select: { id: true },
    });
    return branch?.id ?? identifier;
  }

  async doctors(
    branchIdentifier?: string,
    departmentId?: number,
    specialtyId?: number,
    q?: string,
    featuredOnly = false,
    limit?: number,
    onlineOnly = false,
  ) {
    if (specialtyId !== undefined && !Number.isInteger(specialtyId)) {
      throw new BadRequestException('specialtyId không hợp lệ');
    }
    const branchId = await this.resolveBranchId(branchIdentifier);
    const term = q?.trim();
    const effectiveLimit = limit ?? (featuredOnly ? 6 : (term ? 30 : 50));
    const rows = await this.prisma.doctor.findMany({
      where: {
        isActive: true,
        ...(onlineOnly ? { isOnlineConsultationEnabled: true } : {}),
        ...(featuredOnly ? { isFeatured: true } : {}),
        specialties: specialtyId ? { some: { specialtyId } } : undefined,
        user: {
          fullName: term ? { contains: term, mode: 'insensitive' } : undefined,
          ...(branchId ? { branchAssignments: { some: { branchId } } } : {}),
        },
      },
      orderBy: featuredOnly
        ? [{ ratingAverage: 'desc' }, { user: { fullName: 'asc' } }]
        : [{ isFeatured: 'desc' }, { ratingAverage: 'desc' }, { user: { fullName: 'asc' } }],
      take: effectiveLimit,
      select: {
        id: true,
        academicRank: true,
        experienceYears: true,
        biography: true,
        avatarUrl: true,
        consultationFee: true,
        onlineConsultationFee: true,
        isOnlineConsultationEnabled: true,
        ratingAverage: true,
        ratingCount: true,
        isFeatured: true,
        user: {
          select: {
            fullName: true,
            branchAssignments: {
              where: branchId ? { branchId } : undefined,
              select: {
                isPrimary: true,
                branch: { select: { id: true, name: true, address: true } },
              },
            },
          },
        },
        specialties: {
          select: {
            isPrimary: true,
            specialty: { select: { id: true, name: true } },
          },
        },
      },
    });

    return rows.map(({ user, ...doctor }) => ({
      ...doctor,
      fullName: user.fullName || 'Bác sĩ',
      consultationFee: Number(doctor.consultationFee),
      onlineConsultationFee: Number(doctor.onlineConsultationFee ?? doctor.consultationFee),
      branchAssignments: user.branchAssignments,
    }));
  }

  async availableDates(doctorId: string, branchId: string) {
    const { minDate, maxDate } = this.getBookingAllowedDateRange();
    const schedules = await this.prisma.doctorSchedule.findMany({
      where: { doctorId, branchId, status: 'OPEN', workDate: { gte: minDate, lte: maxDate } },
      select: { workDate: true },
      orderBy: { workDate: 'asc' },
      take: 90,
    });
    return Array.from(new Set(schedules.map(({ workDate }) => workDate.toISOString().slice(0, 10))));
  }

  async timeslots(doctorId: string, branchId: string, date: string) {
    const workDate = parseDateUtil(date) ?? new Date(`${date}T00:00:00.000Z`);
    this.validateDateWithinBookingRange(workDate);
    const schedule = await this.prisma.doctorSchedule.findFirst({
      where: { doctorId, branchId, workDate, status: 'OPEN' },
      select: {
        room: { select: { id: true, code: true, name: true, branch: { select: { id: true, name: true, address: true } } } },
        slots: {
          where: { isActive: true },
          select: {
            id: true,
            startTime: true,
            endTime: true,
            capacity: true,
            occupiedCount: true,
            slotStatus: true,
          },
          orderBy: { startTime: 'asc' },
        },
      },
    });

    if (!schedule) return [];

    return schedule.slots.map((s) => ({
      id: s.id,
      startTime: s.startTime.toISOString().slice(11, 16),
      endTime: s.endTime.toISOString().slice(11, 16),
      capacity: s.capacity,
      occupiedCount: s.occupiedCount,
      remainingCapacity: Math.max(s.capacity - s.occupiedCount, 0),
      isAvailable: s.slotStatus === 'AVAILABLE' && s.occupiedCount < s.capacity,
      slotStatus: s.slotStatus,
      room: schedule.room,
    }));
  }

  public getBookingAllowedDateRange(): { minDate: Date; maxDate: Date } {
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

  public validateDateWithinBookingRange(targetDate: Date): void {
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
      throw new BadRequestException(
        'Hệ thống không nhận đặt lịch trực tuyến trong ngày. Để khám trong ngày hôm nay, quý khách vui lòng đến trực tiếp phòng khám để lấy số thứ tự tại quầy tiếp đón.',
      );
    }

    if (diffDays > 30) {
      throw new BadRequestException(
        'Hệ thống chỉ mở đặt lịch trực tuyến trước tối đa 30 ngày.',
      );
    }

    if (diffDays === 1) {
      const isPastCutoff = currentHour > 16 || (currentHour === 16 && currentMinute >= 30);
      if (isPastCutoff) {
        throw new BadRequestException(
          'Để khám vào ngày mai, quý khách vui lòng hoàn tất đặt lịch trước 16h30 hôm nay. Quý khách vui lòng chọn ngày khám khác hoặc đến lấy số trực tiếp tại quầy tiếp đón.',
        );
      }
    }
  }



  async getQueueSummary(userId: string, dateStr?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        role: true,
        doctor: { select: { id: true, academicRank: true } },
      },
    });

    if (!user || user.role !== 'DOCTOR' || !user.doctor?.id) {
      throw new ForbiddenException('Chỉ bác sĩ mới có quyền xem hàng đợi khám bệnh của bác sĩ');
    }

    const doctorId = user.doctor.id;
    const { from, to, dateKey } = parseDateRange(dateStr);

    const rows = await this.prisma.appointment.groupBy({
      by: ['status'],
      where: {
        scheduleSlot: {
          schedule: {
            doctorId,
            workDate: { gte: from, lt: to },
          },
        },
      },
      _count: { _all: true },
    });

    const countStatus = (st: string) => rows.find((r) => r.status === st)?._count._all || 0;
    const hold = countStatus('HOLD');
    const confirmed = countStatus('CONFIRMED');
    const checkedIn = countStatus('CHECKED_IN');
    const examined = countStatus('COMPLETED');
    const cancelled = countStatus('CANCELLED');

    const displayName = `${user.doctor.academicRank ? user.doctor.academicRank + ' ' : ''}${user.fullName || ''}`.trim();

    return {
      date: dateKey,
      doctorId,
      doctorName: displayName,
      appointments: {
        total: hold + confirmed + checkedIn + examined + cancelled,
        pending: hold,
        confirmed: confirmed + checkedIn,
        examined,
        cancelled,
      },
    };
  }
}
