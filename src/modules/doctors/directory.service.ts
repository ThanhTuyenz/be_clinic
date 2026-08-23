import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';

@Injectable()
export class DirectoryService {
  constructor(private readonly prisma: PrismaService) {}

  branches() {
    return this.prisma.branch.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, code: true, name: true, address: true, phoneNumber: true, timezone: true } });
  }

  async publicNavigation() {
    const [specialties, branches] = await Promise.all([
      this.prisma.specialty.findMany({
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          description: true,
          branches: { where: { isActive: true }, select: { branchId: true } },
        },
      }),
      this.prisma.branch.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, code: true, name: true, address: true, phoneNumber: true },
      }),
    ]);

    return { departments: specialties, specialties, branches };
  }

  specialties() {
    return this.prisma.specialty.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, description: true, branches: { where: { isActive: true }, select: { branchId: true } } },
    });
  }

  async homepage(branchId?: string) {
    const selectedBranch = branchId
      ? await this.prisma.branch.findFirst({ where: { id: branchId, isActive: true }, select: { id: true, code: true, name: true, address: true, phoneNumber: true } })
      : await this.prisma.branch.findFirst({ where: { isActive: true }, orderBy: [{ code: 'asc' }, { name: 'asc' }], select: { id: true, code: true, name: true, address: true, phoneNumber: true } });
    const activeBranchId = selectedBranch?.id;
    const [navigation, featuredDoctors, specialtyPackages, healthPackages, bookingMethods, doctorCount, specialtyCount, reviewAggregate] = await Promise.all([
      this.publicNavigation(),
      this.doctors(activeBranchId, undefined, undefined, undefined, true),
      activeBranchId ? this.homepageSpecialtyPackages(activeBranchId) : Promise.resolve([]),
      this.healthPackages(activeBranchId),
      activeBranchId ? this.bookingMethods(activeBranchId) : Promise.resolve([]),
      this.prisma.doctor.count({ where: { isActive: true, user: activeBranchId ? { branchAssignments: { some: { branchId: activeBranchId } } } : undefined } }),
      this.prisma.specialty.count(),
      this.prisma.review.aggregate({ where: { isActive: true, doctor: { isActive: true } }, _avg: { rating: true }, _count: { id: true } }),
    ]);
    return { selectedBranch, branches: navigation.branches, departments: navigation.departments, specialties: navigation.specialties, featuredDoctors: featuredDoctors.slice(0, 6), specialtyPackages: specialtyPackages.slice(0, 8), healthPackages: healthPackages.slice(0, 6), bookingMethods, stats: { doctorCount, branchCount: navigation.branches.length, specialtyCount, reviewCount: reviewAggregate._count.id, averageRating: reviewAggregate._avg.rating ?? 0 } };
  }

  private async homepageSpecialtyPackages(branchId: string) {
    const rows = await this.prisma.servicePackage.findMany({
      where: { isActive: true, branchBookingMethod: { branchId, isEnabled: true, bookingMethod: { code: 'SPECIALTY_EXAM', isActive: true } } },
      orderBy: [{ specialty: { name: 'asc' } }, { price: 'asc' }],
      select: { id: true, code: true, name: true, description: true, price: true, durationMin: true, specialtyId: true, specialty: { select: { id: true, name: true } }, branchBookingMethod: { select: { branchId: true } } },
    });
    return rows.map(({ branchBookingMethod, ...item }) => ({ ...item, branchId: branchBookingMethod.branchId }));
  }

  departments(branchId: string) {
    return this.prisma.specialty.findMany({
      where: { branches: { some: { branchId, isActive: true } } },
      orderBy: { name: 'asc' }, select: { id: true, name: true, description: true },
    });
  }

  async specialtyServices(branchId: string | undefined, specialtyId: number) {
    if (!Number.isInteger(specialtyId)) throw new BadRequestException('Thiếu chuyên khoa');
    const rows = await this.prisma.servicePackage.findMany({
      where: { specialtyId, isActive: true, branchBookingMethod: { ...(branchId ? { branchId } : {}), isEnabled: true, bookingMethod: { isActive: true } } },
      orderBy: [{ price: 'asc' }, { name: 'asc' }],
      select: { id: true, code: true, name: true, description: true, price: true, durationMin: true, specialtyId: true, branchBookingMethod: { select: { id: true, branchId: true, bookingMethod: { select: { id: true, code: true, name: true } } } } },
    });
    return rows.map(({ branchBookingMethod, ...service }) => ({ ...service, branchId: branchBookingMethod.branchId, branchBookingMethodId: branchBookingMethod.id, bookingMethod: branchBookingMethod.bookingMethod }));
  }

  async servicePackageScheduleDates(packageId: string) {
    if (!packageId) throw new BadRequestException('Thiếu gói dịch vụ');
    const rows = await this.prisma.servicePackageSchedule.findMany({
      where: { servicePackageId: packageId, isActive: true, examDate: { gte: this.today() }, slots: { some: { isActive: true } } },
      select: { examDate: true }, orderBy: { examDate: 'asc' }, take: 90,
    });
    return rows.map(({ examDate }) => examDate.toISOString().slice(0, 10));
  }

  async servicePackageTimeslots(packageId: string, date: string) {
    if (!packageId) throw new BadRequestException('Thiếu gói dịch vụ');
    const examDate = this.parseDate(date);
    const rows = await this.prisma.servicePackageScheduleSlot.findMany({
      where: { isActive: true, schedule: { servicePackageId: packageId, examDate, isActive: true } },
      orderBy: { startTime: 'asc' },
      include: { schedule: { select: { room: { select: { id: true, code: true, name: true, branch: { select: { id: true, name: true, address: true } } } } } } },
    });
    return rows.map(({ schedule, ...slot }) => ({ ...slot, room: schedule.room, startTime: slot.startTime.toISOString().slice(11, 16), endTime: slot.endTime.toISOString().slice(11, 16), remainingCapacity: slot.capacity - slot.occupiedCount, isAvailable: slot.occupiedCount < slot.capacity }));
  }

  async healthPackages(branchId?: string) {
    const rows = await this.prisma.servicePackage.findMany({
      where: { isActive: true, branchBookingMethod: { branchId, isEnabled: true, bookingMethod: { code: 'HEALTH_PACKAGE', isActive: true } } },
      orderBy: { name: 'asc' },
      select: {
        id: true, code: true, name: true, description: true, price: true, branchBookingMethod: { select: { id: true, branchId: true } },
        items: { orderBy: { sortOrder: 'asc' }, select: { quantity: true, medicalService: { select: { id: true, code: true, name: true, category: true } } } },
        schedules: { where: { isActive: true, examDate: { gte: this.today() }, slots: { some: { isActive: true } } }, orderBy: { examDate: 'asc' }, select: { id: true, examDate: true, room: { select: { id: true, code: true, name: true } }, slots: { where: { isActive: true }, orderBy: { startTime: 'asc' }, select: { id: true, startTime: true, endTime: true, capacity: true, occupiedCount: true } } } },
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
    if (specialtyId !== undefined && !Number.isInteger(specialtyId)) throw new BadRequestException('specialtyId không hợp lệ');
    const term = q?.trim();
    const rows = await this.prisma.doctor.findMany({
      where: {
        isActive: true,
        specialties: specialtyId ? { some: { specialtyId } } : undefined,
        user: {
          fullName: term ? { contains: term, mode: 'insensitive' } : undefined,
          ...(branchId ? { branchAssignments: { some: { branchId } } } : {}),
        },
      },
      orderBy: featuredOnly
        ? [{ ratingAverage: 'desc' }, { user: { fullName: 'asc' } }]
        : [{ isFeatured: 'desc' }, { ratingAverage: 'desc' }, { user: { fullName: 'asc' } }],
      select: {
        id: true,
        academicRank: true,
        experienceYears: true,
        biography: true,
        consultationFee: true,
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
                branch: { select: { id: true, name: true, address: true } }
              }
            }
          }
        },
        specialties: {
          select: {
            isPrimary: true,
            specialty: { select: { id: true, name: true } }
          }
        }
      },
    });
    return rows.map(({ user, ...doctor }) => ({
      ...doctor,
      fullName: user.fullName || 'Bác sĩ',
      branchAssignments: user.branchAssignments
    }));
  }

  async availableDates(doctorId: string, branchId: string) {
    const schedules = await this.prisma.doctorSchedule.findMany({
      where: { doctorId, branchId, status: 'OPEN', workDate: { gte: this.today() } },
      select: { workDate: true },
      orderBy: { workDate: 'asc' },
      take: 90,
    });
    return Array.from(new Set(schedules.map(({ workDate }) => workDate.toISOString().slice(0, 10))));
  }

  async timeslots(doctorId: string, branchId: string, date: string) {
    const workDate = this.parseDate(date);
    const schedule = await this.prisma.doctorSchedule.findFirst({
      where: { doctorId, branchId, workDate, status: 'OPEN' },
      include: {
        room: { select: { id: true, code: true, name: true, branch: { select: { id: true, name: true, address: true } } } },
        slots: {
          where: { isActive: true },
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

  private today(): Date { const date = new Date(); date.setUTCHours(0, 0, 0, 0); return date; }
  private parseDate(value: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('Ngày phải có định dạng YYYY-MM-DD');
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) throw new BadRequestException('Ngày không hợp lệ');
    return date;
  }
}

