import { getPackageDeployments } from './helpers/package-deployment.helper.js';
import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { getStaffUser } from '../../common/utils/staff.utils.js';
import { CLINIC_SESSION_WINDOWS } from '../../common/constants/clinic-sessions.js';
import { PACKAGE_RECEPTION_SELECT, packageAcceptsSlot } from './helpers/package-reception.helper.js';
import { CreatePackageReceptionSlotsDto, UpdatePackageReceptionSlotDto } from './dtos/package-reception-slot.dto.js';
import { onlineBookingDateRange } from './helpers/booking-date.helper.js';

@Injectable()
export class PackageReceptionSlotsService {
  constructor(private readonly prisma: PrismaService) {}

  private async branch(userId: string) {
    const actor = await getStaffUser(this.prisma, userId);
    if (actor.role !== 'BRANCH_MANAGER' || !actor.branchId) throw new ForbiddenException('Chỉ quản lý chi nhánh được cấu hình khung tiếp nhận');
    return actor.branchId;
  }

  async list(userId: string, packageId?: number) {
    const branchId = await this.branch(userId);
    if (packageId !== undefined && (!Number.isInteger(packageId) || packageId < 1)) throw new BadRequestException('Mã gói khám không hợp lệ');
    const from = new Date(new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10));
    const rows = await this.prisma.packageReceptionSlot.findMany({
      where: { receptionSchedule: { branchId, ...(packageId ? { servicePackageId: packageId } : {}) }, date: { gte: from } },
      select: { id: true, receptionScheduleId: true, date: true, startTime: true, endTime: true, capacity: true, occupiedCount: true, isActive: true, receptionSchedule: { select: { servicePackageId: true, servicePackage: { select: { name: true } } } } },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }], take: 1000,
    });
    return rows.map(({ receptionSchedule, ...slot }) => ({ ...slot, servicePackageId: receptionSchedule.servicePackageId, servicePackage: receptionSchedule.servicePackage }));
  }

  async create(userId: string, input: CreatePackageReceptionSlotsDto) {
    const branchId = await this.branch(userId);
    const range = onlineBookingDateRange(60);
    const from = range.resolveDate(input.from).requestedDate;
    const to = range.resolveDate(input.to).requestedDate;
    const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
    const start = minutes(input.startTime), end = minutes(input.endTime);
    if (to < from || end <= start || (end - start) % input.slotDurationMin !== 0) throw new BadRequestException('Khoảng ngày hoặc khung giờ không hợp lệ; thời lượng phải chia hết khoảng giờ tiếp nhận');
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM branches WHERE id = ${branchId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM package_reception_schedules WHERE branch_id = ${branchId} AND service_package_id = ${input.servicePackageId} ORDER BY id FOR SHARE`;
      const pkg = await tx.servicePackage.findUnique({ where: { id: input.servicePackageId }, select: PACKAGE_RECEPTION_SELECT });
      if (!pkg?.isActive || !getPackageDeployments(pkg).some(method => method.isEnabled && method.branchId === branchId && method.bookingMethod.code === 'HEALTH_PACKAGE')) {
        throw new BadRequestException('Gói khám chưa được triển khai theo hình thức gói tổng quát tại chi nhánh');
      }
      const data: Prisma.PackageReceptionSlotCreateManyInput[] = [];
      const timeValue = (value: number) => new Date(Date.UTC(1970, 0, 1, Math.floor(value / 60), value % 60));
      for (let day = from.getTime(); day <= to.getTime(); day += 86400000) {
        const date = new Date(day);
        const source = pkg.receptionSchedules.find(schedule => schedule.branchId === branchId && schedule.dayOfWeek === date.getUTCDay());
        if (!source) continue;
        for (let cursor = start; cursor < end; cursor += input.slotDurationMin) {
          const startTime = timeValue(cursor), endTime = timeValue(cursor + input.slotDurationMin);
          if (!packageAcceptsSlot(pkg.receptionSchedules, branchId, date, startTime)) continue;
          const allowedWindow = Object.values(CLINIC_SESSION_WINDOWS).find(window => startTime.toISOString().slice(11, 16) >= window.start && startTime.toISOString().slice(11, 16) < window.end);
          if (!allowedWindow || endTime.toISOString().slice(11, 16) > allowedWindow.end) continue;
          data.push({ receptionScheduleId: source.id, date, startTime, endTime, capacity: input.capacity });
        }
      }
      if (!data.length) throw new BadRequestException('Không có khung nào nằm trong ngày và buổi tiếp nhận đã cấu hình của gói');
      const existing = await tx.packageReceptionSlot.findMany({
        where: { receptionSchedule: { branchId, servicePackageId: input.servicePackageId }, date: { gte: from, lte: to } },
        select: { date: true, startTime: true, endTime: true },
      });
      if (data.some(item => existing.some(old => old.date.getTime() === (item.date as Date).getTime() && old.startTime < item.endTime && old.endTime > item.startTime && (old.startTime.getTime() !== (item.startTime as Date).getTime() || old.endTime.getTime() !== (item.endTime as Date).getTime())))) throw new ConflictException('Khung mới chồng lấn với khung tiếp nhận hiện có');
      return tx.packageReceptionSlot.createMany({ data, skipDuplicates: true });
    });
  }

  async update(userId: string, id: number, input: UpdatePackageReceptionSlotDto) {
    const branchId = await this.branch(userId);
    const result = await this.prisma.packageReceptionSlot.updateMany({
      where: { id, receptionSchedule: { branchId }, ...(input.capacity !== undefined ? { occupiedCount: { lte: input.capacity } } : {}) }, data: input,
    });
    if (result.count !== 1) throw new ConflictException('Không tìm thấy khung tại chi nhánh hoặc sức chứa nhỏ hơn số chỗ đã đặt');
    return { success: true };
  }
}
