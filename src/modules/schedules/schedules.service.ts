import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
    const workDate = this.parseDate(date);
    const schedule = await this.prisma.doctorSchedule.findFirst({
      where: {
        doctorId,
        workDate,
        status: 'OPEN',
        ...(branchId ? { branchId } : {}),
      },
      include: {
        doctor: { select: { id: true, fullName: true, academicRank: true, consultationFee: true } },
        branch: { select: { id: true, name: true, address: true } },
        room: { select: { id: true, code: true, name: true } },
        slots: {
          where: {
            isActive: true,
            slotStatus: 'AVAILABLE' as any,
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
      doctor: (schedule as any).doctor,
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

  // ─────────────────────────────────────────────────────────────
  // CRUD ca làm việc
  // ─────────────────────────────────────────────────────────────
  async findAll(doctorId?: string, branchId?: string, startDate?: string, endDate?: string) {
    const where: any = {};
    if (doctorId) {
      const doc = await this.prisma.doctor.findFirst({
        where: { OR: [{ id: doctorId }, { userId: doctorId }] },
        select: { id: true },
      });
      where.doctorId = doc ? doc.id : doctorId;
    }
    if (branchId) where.branchId = branchId;
    if (startDate || endDate) {
      where.workDate = {};
      if (startDate) where.workDate.gte = new Date(`${startDate}T00:00:00.000Z`);
      if (endDate) where.workDate.lte = new Date(`${endDate}T23:59:59.999Z`);
    }

    const rows = await this.prisma.doctorSchedule.findMany({
      where,
      orderBy: [{ workDate: 'asc' }, { startTime: 'asc' }],
      include: {
        doctor: { select: { id: true, userId: true, fullName: true, academicRank: true } },
        branch: { select: { id: true, name: true } },
        room: { select: { id: true, code: true, name: true } },
        slots: { where: { isActive: true }, orderBy: { startTime: 'asc' } },
      },
    });

    return rows.map((r) => ({
      ...r,
      workDate: r.workDate.toISOString().slice(0, 10),
      startTime: r.startTime.toISOString().slice(11, 16),
      endTime: r.endTime.toISOString().slice(11, 16),
      slots: r.slots.map((s) => ({
        ...s,
        startTime: s.startTime.toISOString().slice(11, 16),
        endTime: s.endTime.toISOString().slice(11, 16),
        remainingCapacity: s.capacity - s.occupiedCount,
      })),
    }));
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

    const workDate = new Date(`${workDateStr}T00:00:00.000Z`);
    const startDt = new Date(`${workDateStr}T${startTimeStr}:00.000Z`);
    const endDt = new Date(`${workDateStr}T${endTimeStr}:00.000Z`);

    if (startDt >= endDt) {
      throw new BadRequestException('Giờ bắt đầu phải trước giờ kết thúc');
    }

    const existing = await this.prisma.doctorSchedule.findFirst({
      where: { doctorId, branchId, workDate, startTime: startDt },
    });
    if (existing) {
      throw new BadRequestException('Bác sĩ đã có ca làm việc trong khung giờ này');
    }

    const schedule = await this.prisma.doctorSchedule.create({
      data: {
        doctorId,
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
        doctor: { select: { id: true, fullName: true, academicRank: true } },
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

    return { ...schedule, slotsGenerated: slotResult.slotsCreated };
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
        doctor: { select: { id: true, fullName: true, academicRank: true } },
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

    return updated;
  }

  async remove(id: string) {
    const existing = await this.prisma.doctorSchedule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Không tìm thấy lịch làm việc');
    return this.prisma.doctorSchedule.delete({ where: { id } });
  }

  // ─────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────
  private parseDate(value: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException('Ngày phải có định dạng YYYY-MM-DD');
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) throw new BadRequestException('Ngày không hợp lệ');
    return date;
  }
}
