import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';

@Injectable()
export class DirectoryService {
  constructor(private readonly prisma: PrismaService) {}

  branches() {
    return this.prisma.branch.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, code: true, name: true, address: true, phoneNumber: true, timezone: true } });
  }

  departments(branchId: string) {
    return this.prisma.department.findMany({
      where: { doctors: { some: { isActive: true, branchAssignments: { some: { branchId } } } } },
      orderBy: { name: 'asc' }, select: { id: true, name: true, description: true },
    });
  }

  doctors(branchId?: string, departmentId?: number) {
    return this.prisma.doctor.findMany({
      where: { isActive: true, departmentId, branchAssignments: branchId ? { some: { branchId } } : undefined },
      orderBy: { fullName: 'asc' },
      select: { id: true, fullName: true, academicRank: true, consultationFee: true, department: { select: { id: true, name: true } }, branchAssignments: { select: { branch: { select: { id: true, name: true } } } }, specialties: { select: { isPrimary: true, specialty: { select: { id: true, name: true } } } } },
    });
  }

  async availableDates(doctorId: string, branchId: string) {
    const schedules = await this.prisma.doctorSchedule.findMany({
      where: { doctorId, branchId, status: 'OPEN', workDate: { gte: this.today() }, slots: { some: { isActive: true, occupiedCount: { lt: this.prisma.doctorScheduleSlot.fields.capacity } } } },
      select: { workDate: true }, orderBy: { workDate: 'asc' }, take: 90,
    });
    return schedules.map(({ workDate }) => workDate.toISOString().slice(0, 10));
  }

  async timeslots(doctorId: string, branchId: string, date: string) {
    const workDate = this.parseDate(date);
    const rows = await this.prisma.doctorScheduleSlot.findMany({
      where: { isActive: true, schedule: { doctorId, branchId, workDate, status: 'OPEN' } }, orderBy: { startTime: 'asc' },
      select: { id: true, startTime: true, endTime: true, capacity: true, occupiedCount: true },
    });
    return rows.map((slot) => ({ ...slot, startTime: slot.startTime.toISOString().slice(11, 16), endTime: slot.endTime.toISOString().slice(11, 16), remainingCapacity: Math.max(slot.capacity - slot.occupiedCount, 0), isAvailable: slot.occupiedCount < slot.capacity }));
  }

  private today(): Date { const date = new Date(); date.setUTCHours(0, 0, 0, 0); return date; }
  private parseDate(value: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('Ngày phải có định dạng YYYY-MM-DD');
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) throw new BadRequestException('Ngày không hợp lệ');
    return date;
  }
}
