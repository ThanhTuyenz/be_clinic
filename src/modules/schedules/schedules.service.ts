import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { parseDate as parseDateUtil } from '../../common/utils/staff.utils.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';

@Injectable()
export class SchedulesService {
  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────
  // Sinh slot tự động cho một ca trực
  // ─────────────────────────────────────────────────────────────
  /**
   * Tạo các DoctorScheduleSlot trong một transaction cho ca trực đã mở.
   * Chia đều từ startTime → endTime theo durationMinutes.
   * Sử dụng upsert nên an toàn khi gọi lại (idempotent).
   */
  async generateSlotsForShift(
    scheduleId: string,
    startTime: Date,
    endTime: Date,
    durationMinutes: number,
    capacityPerSlot: number,
  ) {
    if (durationMinutes < 10 || durationMinutes > 120) {
      throw new BadRequestException('Thời lượng slot phải từ 10 đến 120 phút');
    }
    if (capacityPerSlot < 1 || capacityPerSlot > 50) {
      throw new BadRequestException('Capacity phải từ 1 đến 50 bệnh nhân/slot');
    }

    const slots: { scheduleId: string; startTime: Date; endTime: Date; capacity: number }[] = [];
    let current = new Date(startTime);
    while (current < endTime) {
      const next = new Date(current.getTime() + durationMinutes * 60_000);
      if (next > endTime) break;
      slots.push({ scheduleId, startTime: new Date(current), endTime: new Date(next), capacity: capacityPerSlot });
      current = next;
    }

    if (slots.length === 0) {
      throw new BadRequestException('Ca trực quá ngắn để tạo slot');
    }

    // Upsert tất cả trong một transaction
    await this.prisma.$transaction(
      slots.map((slot) =>
        this.prisma.doctorScheduleSlot.upsert({
          where: { scheduleId_startTime: { scheduleId: slot.scheduleId, startTime: slot.startTime } },
          update: { capacity: slot.capacity, isActive: true },
          create: {
            scheduleId: slot.scheduleId,
            startTime: slot.startTime,
            endTime: slot.endTime,
            capacity: slot.capacity,
            slotStatus: 'AVAILABLE' as any,
          },
        }),
      ),
    );

    return { scheduleId, slotsCreated: slots.length, durationMinutes, capacityPerSlot };
  }

  // ─────────────────────────────────────────────────────────────
  // Lấy slot còn chỗ của bác sĩ theo ngày
  // ─────────────────────────────────────────────────────────────
  /**
   * GET /doctors/:doctorId/available-slots?date=YYYY-MM-DD
   * Chỉ trả về slot status=AVAILABLE và occupiedCount < capacity.
   */
  async getAvailableSlots(doctorId: string, date: string, branchId?: string) {
    const workDate = parseDateUtil(date);
    const schedule = await this.prisma.doctorSchedule.findFirst({
      where: {
        doctorId,
        workDate,
        status: 'OPEN',
        ...(branchId ? { branchId } : {}),
      },
      include: {
        doctor: { select: { id: true, academicRank: true, consultationFee: true, user: { select: { fullName: true } } } },
        branch: { select: { id: true, name: true, address: true } },
        room: { select: { id: true, code: true, name: true } },
        slots: {
          where: {
            isActive: true,
            slotStatus: 'AVAILABLE' as any,
          },
          select: {
            id: true,
            startTime: true,
            endTime: true,
            capacity: true,
            occupiedCount: true,
          },
          orderBy: { startTime: 'asc' },
        },
      },
    });

    if (!schedule) return { date, slots: [], doctor: null };

    return {
      date,
      scheduleId: schedule.id,
      slotDurationMin: schedule.slotDurationMin,
      doctor: schedule.doctor ? {
        id: schedule.doctor.id,
        fullName: schedule.doctor.user?.fullName ?? '',
        academicRank: schedule.doctor.academicRank,
        consultationFee: schedule.doctor.consultationFee
      } : null,
      branch: (schedule as any).branch,
      room: (schedule as any).room,
      slots: ((schedule as any).slots as any[])
        .filter((s: any) => s.occupiedCount < s.capacity)
        .map((s: any) => ({
          id: s.id,
          startTime: s.startTime.toISOString().slice(11, 16),
          endTime: s.endTime.toISOString().slice(11, 16),
          capacity: s.capacity,
          occupiedCount: s.occupiedCount,
          remainingCapacity: s.capacity - s.occupiedCount,
          isAvailable: true,
        })),
    };
  }

  private getVietnamNow() {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const get = (type: string) => parts.find((p) => p.type === type)?.value || '00';
    const y = get('year');
    const m = get('month');
    const d = get('day');
    const hh = parseInt(get('hour'), 10);
    const mm = parseInt(get('minute'), 10);
    return {
      todayStr: `${y}-${m}-${d}`,
      currentTotalMin: hh * 60 + mm,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // CRUD ca làm việc
  // ─────────────────────────────────────────────────────────────
  async findAll(
    doctorId?: string,
    branchId?: string,
    startDate?: string,
    endDate?: string,
    withSlots: boolean = false,
    availableOnly: boolean = false,
  ) {
    const where: any = {};
    if (doctorId) {
      const doc = await this.prisma.doctor.findFirst({
        where: { OR: [{ id: doctorId }, { userId: doctorId }] },
        select: { id: true },
      });
      where.doctorId = doc ? doc.id : doctorId;
    }
    if (branchId) where.branchId = branchId;
    if (availableOnly) {
      where.status = 'OPEN';
    }
    if (startDate || endDate) {
      where.workDate = {};
      if (startDate) where.workDate.gte = new Date(`${startDate}T00:00:00.000Z`);
      if (endDate) where.workDate.lte = new Date(`${endDate}T23:59:59.999Z`);
    } else if (availableOnly) {
      const vnNow = this.getVietnamNow();
      where.workDate = { gte: new Date(`${vnNow.todayStr}T00:00:00.000Z`) };
    }

    const rows = await this.prisma.doctorSchedule.findMany({
      where,
      orderBy: [{ workDate: 'asc' }, { startTime: 'asc' }],
      include: {
        doctor: { select: { id: true, userId: true, academicRank: true, user: { select: { fullName: true } } } },
        branch: { select: { id: true, name: true } },
        room: { select: { id: true, code: true, name: true } },
        slots: withSlots
          ? { where: { isActive: true }, orderBy: { startTime: 'asc' } }
          : { where: { isActive: true }, select: { startTime: true, endTime: true, capacity: true, occupiedCount: true } },
      },
    });

    const vnNow = this.getVietnamNow();

    const mapped = rows.map((r) => {
      const workDateStr = r.workDate.toISOString().slice(0, 10);
      const isToday = workDateStr === vnNow.todayStr;

      let availableSlotsCount = 0;
      for (const s of (r.slots as any[])) {
        const remaining = (s.capacity || 0) - (s.occupiedCount || 0);
        if (remaining <= 0) continue;
        if (isToday) {
          const sTime = s.startTime instanceof Date
            ? s.startTime.toISOString().slice(11, 16)
            : String(s.startTime || '').slice(0, 5);
          const [sh, sm] = sTime.split(':').map(Number);
          if (!Number.isNaN(sh) && !Number.isNaN(sm)) {
            if (sh * 60 + sm + (r.slotDurationMin || 30) < vnNow.currentTotalMin) {
              continue;
            }
          }
        }
        availableSlotsCount++;
      }

      const totalOccupied = r.slots.reduce((sum: number, s: any) => sum + (s.occupiedCount || 0), 0);
      const totalCapacity = r.slots.reduce((sum: number, s: any) => sum + (s.capacity || 0), 0);
      const hasAvailableSlots = availableSlotsCount > 0;

      return {
        id: r.id,
        doctorId: r.doctorId,
        branchId: r.branchId,
        roomId: r.roomId,
        slotDurationMin: r.slotDurationMin,
        capacityPerSlot: r.capacityPerSlot,
        status: r.status,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        workDate: workDateStr,
        startTime: r.startTime.toISOString().slice(11, 16),
        endTime: r.endTime.toISOString().slice(11, 16),
        occupiedCount: totalOccupied,
        totalCapacity,
        hasAppointments: totalOccupied > 0,
        availableSlotsCount,
        hasAvailableSlots,
        branch: r.branch,
        room: r.room,
        doctor: r.doctor ? {
          id: r.doctor.id,
          userId: r.doctor.userId,
          fullName: r.doctor.user?.fullName ?? '',
          academicRank: r.doctor.academicRank
        } : null,
        slots: withSlots
          ? (r.slots as any[]).map((s) => ({
              ...s,
              startTime: s.startTime.toISOString().slice(11, 16),
              endTime: s.endTime.toISOString().slice(11, 16),
              remainingCapacity: s.capacity - s.occupiedCount,
            }))
          : [],
      };
    });

    if (availableOnly) {
      return mapped.filter((r) => r.hasAvailableSlots);
    }

    return mapped;
  }

  async create(body: any) {
    const doctorId = String(body.doctorId || '').trim();
    const branchId = String(body.branchId || '').trim();
    const workDateStr = String(body.workDate || '').trim();
    const startTimeStr = String(body.startTime || '08:00').trim();
    const endTimeStr = String(body.endTime || '12:00').trim();
    const roomId = body.roomId ? String(body.roomId).trim() : null;
    const slotDurationMin = Number(body.slotDurationMin) || 30;
    const capacityPerSlot = Number(body.capacityPerSlot) || 1;

    if (!doctorId || !branchId || !workDateStr) {
      throw new BadRequestException('Vui lòng chọn bác sĩ, chi nhánh và ngày làm việc');
    }

    const doc = await this.prisma.doctor.findFirst({
      where: { OR: [{ id: doctorId }, { userId: doctorId }] },
      select: { id: true },
    });
    if (!doc) {
      throw new BadRequestException('Không tìm thấy thông tin hồ sơ bác sĩ');
    }
    const realDoctorId = doc.id;

    const workDate = new Date(`${workDateStr}T00:00:00.000Z`);
    const startDt = new Date(`${workDateStr}T${startTimeStr}:00.000Z`);
    const endDt = new Date(`${workDateStr}T${endTimeStr}:00.000Z`);

    if (startDt >= endDt) {
      throw new BadRequestException('Giờ bắt đầu phải trước giờ kết thúc');
    }

    const existing = await this.prisma.doctorSchedule.findFirst({
      where: { doctorId: realDoctorId, branchId, workDate, startTime: startDt },
    });
    if (existing) {
      throw new BadRequestException('Bác sĩ đã có ca làm việc trong khung giờ này');
    }

    const schedule = await this.prisma.doctorSchedule.create({
      data: {
        doctorId: realDoctorId,
        branchId,
        roomId,
        workDate,
        startTime: startDt,
        endTime: endDt,
        slotDurationMin,
        capacityPerSlot: capacityPerSlot as any,
        status: body.status || 'OPEN',
      },
      include: {
        doctor: { select: { id: true, academicRank: true, user: { select: { fullName: true } } } },
        branch: { select: { id: true, name: true } },
        room: { select: { id: true, code: true, name: true } },
      },
    });

    // Tự động sinh slot ngay khi tạo ca
    const slotResult = await this.generateSlotsForShift(
      schedule.id,
      startDt,
      endDt,
      slotDurationMin,
      capacityPerSlot,
    );

    return {
      ...schedule,
      doctor: schedule.doctor ? {
        id: schedule.doctor.id,
        fullName: schedule.doctor.user?.fullName ?? '',
        academicRank: schedule.doctor.academicRank
      } : null,
      slotsGenerated: slotResult.slotsCreated
    };
  }

  async update(id: string, body: any) {
    const existing = await this.prisma.doctorSchedule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Không tìm thấy lịch làm việc');

    const data: any = {};
    if (body.roomId !== undefined) data.roomId = body.roomId || null;
    if (body.status !== undefined) data.status = body.status;
    if (body.slotDurationMin !== undefined) data.slotDurationMin = Number(body.slotDurationMin) || 30;
    if (body.capacityPerSlot !== undefined) data.capacityPerSlot = Number(body.capacityPerSlot) || 1;

    if (body.workDate || body.startTime || body.endTime) {
      const dateStr = body.workDate ? String(body.workDate).trim() : existing.workDate.toISOString().slice(0, 10);
      const startTimeStr = body.startTime ? String(body.startTime).trim() : existing.startTime.toISOString().slice(11, 16);
      const endTimeStr = body.endTime ? String(body.endTime).trim() : existing.endTime.toISOString().slice(11, 16);
      data.workDate = new Date(`${dateStr}T00:00:00.000Z`);
      data.startTime = new Date(`${dateStr}T${startTimeStr}:00.000Z`);
      data.endTime = new Date(`${dateStr}T${endTimeStr}:00.000Z`);
    }

    const updated = await this.prisma.doctorSchedule.update({
      where: { id },
      data,
      include: {
        doctor: { select: { id: true, academicRank: true, user: { select: { fullName: true } } } },
        branch: { select: { id: true, name: true } },
        room: { select: { id: true, code: true, name: true } },
      },
    });

    // Tái tạo slot nếu thay đổi thời gian hoặc capacity
    if (body.workDate || body.startTime || body.endTime || body.slotDurationMin || body.capacityPerSlot) {
      const finalStart = data.startTime ?? existing.startTime;
      const finalEnd = data.endTime ?? existing.endTime;
      const finalDuration = data.slotDurationMin ?? existing.slotDurationMin;
      const finalCapacity = data.capacityPerSlot ?? (existing as any).capacityPerSlot ?? 1;
      await this.generateSlotsForShift(id, finalStart, finalEnd, finalDuration, finalCapacity);
    }

    return {
      ...updated,
      doctor: updated.doctor ? {
        id: updated.doctor.id,
        fullName: updated.doctor.user?.fullName ?? '',
        academicRank: updated.doctor.academicRank
      } : null
    };
  }

  async remove(id: string) {
    const existing = await this.prisma.doctorSchedule.findUnique({
      where: { id },
      include: {
        slots: {
          select: { id: true, occupiedCount: true },
        },
      },
    });
    if (!existing) throw new NotFoundException('Không tìm thấy lịch làm việc');

    const totalOccupied = existing.slots.reduce((sum, s) => sum + (s.occupiedCount || 0), 0);
    const appointmentCount = await this.prisma.appointment.count({
      where: { scheduleSlot: { scheduleId: id } },
    });

    if (totalOccupied > 0 || appointmentCount > 0) {
      throw new BadRequestException(
        `Không thể xóa ca trực này vì đã có ${appointmentCount || totalOccupied} lịch hẹn của bệnh nhân. Vui lòng dời lịch hoặc hủy hẹn trước khi xóa.`,
      );
    }

    return this.prisma.doctorSchedule.delete({ where: { id } });
  }

  // ─────────────────────────────────────────────────────────────
  // Phân ca định kỳ / Hàng loạt (Batch Scheduling)
  // ─────────────────────────────────────────────────────────────
  async createBatch(body: {
    doctorId: string;
    branchId: string;
    roomId?: string | null;
    startDate: string;
    endDate: string;
    daysOfWeek: number[]; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    shifts?: { startTime: string; endTime: string }[];
    startTime?: string;
    endTime?: string;
    slotDurationMin?: number;
    capacityPerSlot?: number;
    status?: any;
  }) {
    const { doctorId: rawDoctorId, branchId, startDate, endDate, daysOfWeek } = body;
    if (!rawDoctorId || !branchId || !startDate || !endDate || !daysOfWeek || !daysOfWeek.length) {
      throw new BadRequestException('Vui lòng cung cấp đầy đủ thông tin: Bác sĩ, Chi nhánh, Ngày bắt đầu, Ngày kết thúc và các thứ trong tuần.');
    }

    const doc = await this.prisma.doctor.findFirst({
      where: { OR: [{ id: rawDoctorId }, { userId: rawDoctorId }] },
      select: { id: true },
    });
    if (!doc) {
      throw new BadRequestException('Không tìm thấy thông tin hồ sơ bác sĩ');
    }
    const doctorId = doc.id;

    const shiftList: { startTime: string; endTime: string }[] =
      body.shifts && body.shifts.length > 0
        ? body.shifts
        : [
            {
              startTime: String(body.startTime || '08:00').trim(),
              endTime: String(body.endTime || '12:00').trim(),
            },
          ];

    const roomId = body.roomId ? String(body.roomId).trim() : null;
    const slotDurationMin = Number(body.slotDurationMin) || 30;
    const capacityPerSlot = Number(body.capacityPerSlot) || 1;
    const status = body.status || 'OPEN';

    const start = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${endDate}T00:00:00.000Z`);
    if (start > end) {
      throw new BadRequestException('Ngày bắt đầu không được lớn hơn ngày kết thúc.');
    }

    let createdCount = 0;
    let skippedCount = 0;

    const curr = new Date(start);
    while (curr <= end) {
      const day = curr.getUTCDay();
      if (daysOfWeek.includes(day)) {
        const dateStr = curr.toISOString().slice(0, 10);
        const workDate = new Date(`${dateStr}T00:00:00.000Z`);

        // Check if doctor has exception/leave on this day
        const hasException = await this.prisma.doctorScheduleException.findFirst({
          where: { doctorId, branchId, date: workDate, isClosed: true },
        });

        if (hasException) {
          skippedCount += shiftList.length;
        } else {
          for (const shift of shiftList) {
            const startDt = new Date(`${dateStr}T${shift.startTime}:00.000Z`);
            const endDt = new Date(`${dateStr}T${shift.endTime}:00.000Z`);

            const existing = await this.prisma.doctorSchedule.findFirst({
              where: { doctorId, branchId, workDate, startTime: startDt },
            });

            if (existing) {
              skippedCount++;
            } else {
              try {
                const schedule = await this.prisma.doctorSchedule.create({
                  data: {
                    doctorId,
                    branchId,
                    roomId,
                    workDate,
                    startTime: startDt,
                    endTime: endDt,
                    slotDurationMin,
                    capacityPerSlot,
                    status,
                  },
                });

                await this.generateSlotsForShift(
                  schedule.id,
                  startDt,
                  endDt,
                  slotDurationMin,
                  capacityPerSlot,
                );
                createdCount++;
              } catch (err: any) {
                console.error('[createBatch ERROR creating schedule]:', err?.message || err);
                skippedCount++;
              }
            }
          }
        }
      }
      curr.setUTCDate(curr.getUTCDate() + 1);
    }

    return {
      success: true,
      createdCount,
      skippedCount,
      message: `Đã tạo thành công ${createdCount} ca trực (bỏ qua ${skippedCount} ca trùng hoặc ngày bác sĩ nghỉ).`,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Sao chép lịch tuần (Copy Week)
  // ─────────────────────────────────────────────────────────────
  async copyWeek(body: {
    sourceMonday: string; // YYYY-MM-DD
    targetMonday: string; // YYYY-MM-DD
    branchId?: string;
  }) {
    const { sourceMonday, targetMonday, branchId } = body;
    if (!sourceMonday || !targetMonday) {
      throw new BadRequestException('Vui lòng chọn tuần nguồn và tuần đích.');
    }

    const srcStart = new Date(`${sourceMonday}T00:00:00.000Z`);
    const srcEnd = new Date(srcStart.getTime() + 6 * 24 * 60 * 60 * 1000);
    const tgtStart = new Date(`${targetMonday}T00:00:00.000Z`);

    const daysDiff = Math.round((tgtStart.getTime() - srcStart.getTime()) / (24 * 60 * 60 * 1000));
    if (daysDiff === 0) {
      throw new BadRequestException('Tuần nguồn và tuần đích không được trùng nhau.');
    }

    const where: any = {
      workDate: {
        gte: srcStart,
        lte: new Date(`${srcEnd.toISOString().slice(0, 10)}T23:59:59.999Z`),
      },
    };
    if (branchId) where.branchId = branchId;

    const sourceSchedules = await this.prisma.doctorSchedule.findMany({
      where,
      orderBy: { workDate: 'asc' },
    });

    if (sourceSchedules.length === 0) {
      throw new BadRequestException('Tuần nguồn không có ca trực nào để sao chép.');
    }

    let copiedCount = 0;
    let skippedCount = 0;

    for (const sc of sourceSchedules) {
      const targetDate = new Date(sc.workDate.getTime() + daysDiff * 24 * 60 * 60 * 1000);
      const targetDateStr = targetDate.toISOString().slice(0, 10);
      const startTimeStr = sc.startTime.toISOString().slice(11, 16);
      const endTimeStr = sc.endTime.toISOString().slice(11, 16);

      const targetStartDt = new Date(`${targetDateStr}T${startTimeStr}:00.000Z`);
      const targetEndDt = new Date(`${targetDateStr}T${endTimeStr}:00.000Z`);
      const targetWorkDate = new Date(`${targetDateStr}T00:00:00.000Z`);

      const existing = await this.prisma.doctorSchedule.findFirst({
        where: {
          doctorId: sc.doctorId,
          branchId: sc.branchId,
          workDate: targetWorkDate,
          startTime: targetStartDt,
        },
      });

      if (existing) {
        skippedCount++;
        continue;
      }

      try {
        const newSchedule = await this.prisma.doctorSchedule.create({
          data: {
            doctorId: sc.doctorId,
            branchId: sc.branchId,
            roomId: sc.roomId,
            workDate: targetWorkDate,
            startTime: targetStartDt,
            endTime: targetEndDt,
            slotDurationMin: sc.slotDurationMin,
            capacityPerSlot: sc.capacityPerSlot,
            status: sc.status,
          },
        });

        await this.generateSlotsForShift(
          newSchedule.id,
          targetStartDt,
          targetEndDt,
          sc.slotDurationMin,
          sc.capacityPerSlot,
        );
        copiedCount++;
      } catch {
        skippedCount++;
      }
    }

    return {
      success: true,
      copiedCount,
      skippedCount,
      message: `Đã sao chép thành công ${copiedCount} ca trực sang tuần mới (bỏ qua ${skippedCount} ca đã tồn tại).`,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Public Branch Schedules & Booking Methods
  // ─────────────────────────────────────────────────────────────
  private async resolveBranchId(identifier?: string): Promise<string | undefined> {
    if (!identifier) return undefined;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier)) return identifier;
    const branch = await this.prisma.branch.findFirst({
      where: { OR: [{ slug: identifier }, { code: identifier }], isActive: true },
      select: { id: true },
    });
    return branch?.id ?? identifier;
  }

  async bookingMethods(branchIdentifier?: string) {
    if (!branchIdentifier) {
      const orderMap: Record<string, number> = {
        SPECIALTY_EXAM: 1,
        CONSULTATION: 2,
        ONLINE_CONSULTATION: 3,
        FOLLOWUP_EXAM: 4,
        FAMILY_BOOKING: 5,
        AFTER_HOURS: 6,
        HEALTH_PACKAGE: 7,
      };

      const rows = await this.prisma.bookingMethod.findMany({
        where: {
          isActive: true,
          branches: {
            some: { isEnabled: true },
          },
        },
        include: {
          branches: {
            where: { isEnabled: true },
            select: { sortOrder: true },
            take: 1,
            orderBy: { sortOrder: 'asc' },
          },
        },
      });

      return rows
        .map((bm) => ({
          id: bm.id,
          branchId: '',
          isEnabled: true,
          sortOrder: bm.branches?.[0]?.sortOrder ?? orderMap[bm.code] ?? 99,
          bookingMethodId: bm.id,
          type: bm.code,
          code: bm.code,
          displayName: bm.name,
          description: bm.description,
          route: bm.route,
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder);
    }
    const branchId = await this.resolveBranchId(branchIdentifier);
    return this.prisma.branchBookingMethod.findMany({
      where: { branchId, isEnabled: true, bookingMethod: { isActive: true } },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, branchId: true, isEnabled: true, sortOrder: true, bookingMethod: { select: { id: true, code: true, name: true, description: true, route: true } } },
    }).then((rows) => rows.map(({ bookingMethod, ...item }) => ({ ...item, bookingMethodId: bookingMethod.id, type: bookingMethod.code, code: bookingMethod.code, displayName: bookingMethod.name, description: bookingMethod.description, route: bookingMethod.route })));
  }

  async branchAvailableDates(branchId: string, specialtyId?: number) {
    const { minDate, maxDate } = this.getBookingAllowedDateRange();
    const schedules = await this.prisma.doctorSchedule.findMany({
      where: {
        branchId,
        status: 'OPEN',
        workDate: { gte: minDate, lte: maxDate },
        ...(specialtyId ? { doctor: { specialties: { some: { specialtyId } } } } : {}),
        slots: { some: { isActive: true, slotStatus: 'AVAILABLE' } },
      },
      select: { workDate: true },
      distinct: ['workDate'],
      orderBy: { workDate: 'asc' },
      take: 90,
    });
    return Array.from(new Set(schedules.map(({ workDate }) => workDate.toISOString().slice(0, 10))));
  }

  async branchTimeslots(branchId: string, date: string, specialtyId?: number) {
    const workDate = parseDateUtil(date);
    this.validateDateWithinBookingRange(workDate);

    const schedules = await this.prisma.doctorSchedule.findMany({
      where: {
        branchId,
        workDate,
        status: 'OPEN',
        ...(specialtyId ? { doctor: { specialties: { some: { specialtyId } } } } : {}),
        slots: { some: { isActive: true, slotStatus: 'AVAILABLE' } },
      },
      select: {
        room: { select: { id: true, code: true, name: true, branch: { select: { id: true, name: true, address: true } } } },
        doctor: {
          select: {
            id: true,
            avatarUrl: true,
            consultationFee: true,
            academicRank: true,
            user: { select: { fullName: true } },
            specialties: {
              select: {
                specialtyId: true,
                specialty: { select: { name: true } },
              },
              take: 1,
            },
          },
        },
        slots: {
          where: { isActive: true, slotStatus: 'AVAILABLE' },
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

    const result: Array<{
      id: string;
      doctorSlotId: string;
      startTime: string;
      endTime: string;
      capacity: number;
      occupiedCount: number;
      remainingCapacity: number;
      isAvailable: boolean;
      slotStatus: string;
      room: any;
      doctor: {
        id: string;
        displayName: string;
        avatarUrl: string;
        consultationFee: number;
        specialtyName: string;
        specialtyID: string;
        academicRank: string | null;
      };
    }> = [];

    for (const sch of (schedules as any[])) {
      const doc = sch.doctor;
      const docName = doc?.user?.fullName || 'Bác sĩ';
      const spec = doc?.specialties?.[0]?.specialty?.name || 'Đa khoa';
      const specId = doc?.specialties?.[0]?.specialtyId ? String(doc.specialties[0].specialtyId) : '';

      for (const s of (sch.slots || [])) {
        if (s.occupiedCount >= s.capacity) continue;
        result.push({
          id: s.id,
          doctorSlotId: s.id,
          startTime: s.startTime.toISOString().slice(11, 16),
          endTime: s.endTime.toISOString().slice(11, 16),
          capacity: s.capacity,
          occupiedCount: s.occupiedCount,
          remainingCapacity: Math.max(s.capacity - s.occupiedCount, 0),
          isAvailable: true,
          slotStatus: s.slotStatus,
          room: sch.room,
          doctor: {
            id: doc.id,
            displayName: docName,
            avatarUrl: doc.avatarUrl || '',
            consultationFee: Number(doc.consultationFee || 200000),
            specialtyName: spec,
            specialtyID: specId,
            academicRank: doc.academicRank || null,
          },
        });
      }
    }

    return result;
  }

  private getBookingAllowedDateRange(): { minDate: Date; maxDate: Date } {
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

  private validateDateWithinBookingRange(targetDate: Date): void {
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
      throw new BadRequestException('Hệ thống chỉ mở đặt lịch trực tuyến trước tối đa 30 ngày.');
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

  // ─────────────────────────────────────────────────────────────
  // Helpers
}

