import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';

@Injectable()
export class SchedulesService {
  constructor(private readonly prisma: PrismaService) {}

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

    return this.prisma.doctorSchedule.create({
      data: {
        doctorId,
        branchId,
        roomId,
        workDate,
        startTime: startDt,
        endTime: endDt,
        slotDurationMin,
        status: body.status || 'OPEN',
      },
      include: {
        doctor: { select: { id: true, fullName: true, academicRank: true } },
        branch: { select: { id: true, name: true } },
        room: { select: { id: true, code: true, name: true } },
      },
    });
  }

  async update(id: string, body: any) {
    const existing = await this.prisma.doctorSchedule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Không tìm thấy lịch làm việc');

    const data: any = {};
    if (body.roomId !== undefined) data.roomId = body.roomId || null;
    if (body.status !== undefined) data.status = body.status;
    if (body.slotDurationMin !== undefined) data.slotDurationMin = Number(body.slotDurationMin) || 30;

    if (body.workDate || body.startTime || body.endTime) {
      const dateStr = body.workDate ? String(body.workDate).trim() : existing.workDate.toISOString().slice(0, 10);
      const startTimeStr = body.startTime ? String(body.startTime).trim() : existing.startTime.toISOString().slice(11, 16);
      const endTimeStr = body.endTime ? String(body.endTime).trim() : existing.endTime.toISOString().slice(11, 16);

      data.workDate = new Date(`${dateStr}T00:00:00.000Z`);
      data.startTime = new Date(`${dateStr}T${startTimeStr}:00.000Z`);
      data.endTime = new Date(`${dateStr}T${endTimeStr}:00.000Z`);
    }

    return this.prisma.doctorSchedule.update({
      where: { id },
      data,
      include: {
        doctor: { select: { id: true, fullName: true, academicRank: true } },
        branch: { select: { id: true, name: true } },
        room: { select: { id: true, code: true, name: true } },
      },
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.doctorSchedule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Không tìm thấy lịch làm việc');

    return this.prisma.doctorSchedule.delete({ where: { id } });
  }
}
