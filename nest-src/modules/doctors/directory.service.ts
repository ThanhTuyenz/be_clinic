import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';

@Injectable()
export class DirectoryService {
  constructor(private readonly prisma: PrismaService) {}

  branches() {
    return this.prisma.branch.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, code: true, name: true, address: true, phoneNumber: true, timezone: true } });
  }

  async publicNavigation() {
    const [departments, branches] = await Promise.all([
      this.prisma.department.findMany({
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          specialties: { orderBy: { name: 'asc' }, select: { id: true, name: true } },
        },
      }),
      this.prisma.branch.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, code: true, name: true, address: true, phoneNumber: true },
      }),
    ]);

    return { departments, branches };
  }

  specialties() {
    return this.prisma.department.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, description: true, specialties: { orderBy: { name: 'asc' }, select: { id: true, name: true, description: true } } },
    });
  }

  async homepage(branchId?: string) {
    const selectedBranch = branchId
      ? await this.prisma.branch.findFirst({ where: { id: branchId, isActive: true }, select: { id: true, code: true, name: true, address: true, phoneNumber: true } })
      : await this.prisma.branch.findFirst({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, code: true, name: true, address: true, phoneNumber: true } });
    const activeBranchId = selectedBranch?.id;
    const [navigation, featuredDoctors, healthPackages, bookingMethods, doctorCount, specialtyCount, reviewAggregate] = await Promise.all([
      this.publicNavigation(),
      this.doctors(activeBranchId, undefined, undefined, undefined, true),
      this.healthPackages(activeBranchId),
      activeBranchId ? this.bookingMethods(activeBranchId) : Promise.resolve([]),
      this.prisma.doctor.count({ where: { isActive: true, user: activeBranchId ? { branchAssignments: { some: { branchId: activeBranchId } } } : undefined } }),
      this.prisma.specialty.count(),
      this.prisma.review.aggregate({ where: { isActive: true, doctor: { isActive: true } }, _avg: { rating: true }, _count: { id: true } }),
    ]);
    return { selectedBranch, branches: navigation.branches, departments: navigation.departments, featuredDoctors: featuredDoctors.slice(0, 6), healthPackages: healthPackages.slice(0, 6), bookingMethods, stats: { doctorCount, branchCount: navigation.branches.length, specialtyCount, reviewCount: reviewAggregate._count.id, averageRating: reviewAggregate._avg.rating ?? 0 } };
  }

  departments(branchId: string) {
    return this.prisma.department.findMany({
      where: { doctors: { some: { isActive: true, user: { branchAssignments: { some: { branchId } } } } } },
      orderBy: { name: 'asc' }, select: { id: true, name: true, description: true },
    });
  }

  async specialtyServices(branchId: string, specialtyId: number) {
    if (!branchId || !Number.isInteger(specialtyId)) throw new BadRequestException('Thiếu chi nhánh hoặc chuyên khoa');
    const rows = await this.prisma.specialtyService.findMany({
      where: { specialtyId, isActive: true, branchBookingMethod: { branchId, isEnabled: true, bookingMethod: { isActive: true } } },
      orderBy: [{ price: 'asc' }, { name: 'asc' }],
      select: { id: true, code: true, name: true, description: true, price: true, durationMin: true, specialtyId: true, branchBookingMethod: { select: { id: true, branchId: true, bookingMethod: { select: { id: true, code: true, name: true } } } } },
    });
    return rows.map(({ branchBookingMethod, ...service }) => ({ ...service, branchId: branchBookingMethod.branchId, branchBookingMethodId: branchBookingMethod.id, bookingMethod: branchBookingMethod.bookingMethod }));
  }

  async healthPackages(branchId?: string) {
    const rows = await this.prisma.healthPackage.findMany({
      where: { isActive: true, branchBookingMethod: { branchId, isEnabled: true, bookingMethod: { code: 'HEALTH_PACKAGE', isActive: true } } },
      orderBy: { name: 'asc' },
      select: {
        id: true, code: true, name: true, description: true, price: true, branchBookingMethod: { select: { id: true, branchId: true } },
        items: { orderBy: { sortOrder: 'asc' }, select: { quantity: true, medicalService: { select: { id: true, code: true, name: true, category: true } } } },
        schedules: { where: { isActive: true, examDate: { gte: this.today() } }, orderBy: { examDate: 'asc' }, select: { id: true, examDate: true, capacity: true, room: { select: { id: true, code: true, name: true } } } },
      },
    });
    return rows.map(({ branchBookingMethod, ...healthPackage }) => ({ ...healthPackage, branchId: branchBookingMethod.branchId, branchBookingMethodId: branchBookingMethod.id }));
  }

  bookingMethods(branchId: string) {
    if (!branchId) throw new BadRequestException('Thiếu chi nhánh');
    return this.prisma.branchBookingMethod.findMany({
      where: { branchId, isEnabled: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, branchId: true, isEnabled: true, sortOrder: true, bookingMethod: { select: { id: true, code: true, name: true, description: true, route: true } } },
    }).then((rows) => rows.map(({ bookingMethod, ...item }) => ({ ...item, bookingMethodId: bookingMethod.id, type: bookingMethod.code, code: bookingMethod.code, displayName: bookingMethod.name, description: bookingMethod.description, route: bookingMethod.route })));
  }

  async doctors(branchId?: string, departmentId?: number, specialtyId?: number, q?: string, featuredOnly = false) {
    if (departmentId !== undefined && !Number.isInteger(departmentId)) throw new BadRequestException('departmentId không hợp lệ');
    if (specialtyId !== undefined && !Number.isInteger(specialtyId)) throw new BadRequestException('specialtyId không hợp lệ');
    const term = q?.trim();
    const rows = await this.prisma.doctor.findMany({
      where: { isActive: true, isFeatured: featuredOnly ? true : undefined, departmentId, fullName: term ? { contains: term, mode: 'insensitive' } : undefined, specialties: specialtyId ? { some: { specialtyId } } : undefined, user: branchId ? { branchAssignments: { some: { branchId } } } : undefined },
      orderBy: featuredOnly ? [{ ratingAverage: 'desc' }, { fullName: 'asc' }] : [{ isFeatured: 'desc' }, { ratingAverage: 'desc' }, { fullName: 'asc' }],
      select: { id: true, fullName: true, academicRank: true, experienceYears: true, biography: true, consultationFee: true, ratingAverage: true, ratingCount: true, isFeatured: true, department: { select: { id: true, name: true } }, user: { select: { branchAssignments: { where: branchId ? { branchId } : undefined, select: { isPrimary: true, branch: { select: { id: true, name: true, address: true } } } } } }, specialties: { select: { isPrimary: true, specialty: { select: { id: true, name: true } } } } },
    });
    return rows.map(({ user, ...doctor }) => ({ ...doctor, branchAssignments: user.branchAssignments }));
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
