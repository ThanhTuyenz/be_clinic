import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';

@Injectable()
export class DirectoryService {
  constructor(private readonly prisma: PrismaService) {}

  private isUuid(val?: string | null): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val || '');
  }

  private async resolveBranchId(identifier?: string): Promise<string | undefined> {
    if (!identifier) return undefined;
    if (this.isUuid(identifier)) return identifier;
    const branch = await this.prisma.branch.findFirst({
      where: { OR: [{ slug: identifier }, { code: identifier }], isActive: true },
      select: { id: true },
    });
    return branch?.id ?? identifier;
  }

  branches() {
    return this.prisma.branch.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, code: true, slug: true, name: true, address: true, latitude: true, longitude: true, phoneNumber: true, timezone: true },
    });
  }

  async publicNavigation() {
    const [specialties, branches] = await Promise.all([
      this.prisma.specialty.findMany({
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          branches: { where: { isActive: true }, select: { branchId: true } },
        },
      }),
      this.prisma.branch.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, code: true, slug: true, name: true, address: true, latitude: true, longitude: true, phoneNumber: true },
      }),
    ]);

    return { departments: specialties, specialties, branches };
  }

  specialties() {
    return this.prisma.specialty.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true, description: true, branches: { where: { isActive: true }, select: { branchId: true } } },
    });
  }

  async homepage(branchIdentifier?: string) {
    const isId = this.isUuid(branchIdentifier);
    const selectedBranch = branchIdentifier
      ? await this.prisma.branch.findFirst({
          where: isId
            ? { id: branchIdentifier, isActive: true }
            : { OR: [{ slug: branchIdentifier }, { code: branchIdentifier }], isActive: true },
          select: { id: true, code: true, slug: true, name: true, address: true, latitude: true, longitude: true, phoneNumber: true },
        })
      : await this.prisma.branch.findFirst({
          where: { isActive: true },
          orderBy: [{ code: 'asc' }, { name: 'asc' }],
          select: { id: true, code: true, slug: true, name: true, address: true, latitude: true, longitude: true, phoneNumber: true },
        });
    const activeBranchId = selectedBranch?.id;
    const [navigation, featuredDoctors, specialtyPackages, healthPackages, bookingMethods, doctorCount, specialtyCount] = await Promise.all([
      this.publicNavigation(),
      this.doctors(activeBranchId, undefined, undefined, undefined, true, 6),
      activeBranchId ? this.homepageSpecialtyPackages(activeBranchId) : Promise.resolve([]),
      this.healthPackages(activeBranchId, 6),
      activeBranchId ? this.bookingMethods(activeBranchId) : Promise.resolve([]),
      this.prisma.doctor.count({ where: { isActive: true, user: activeBranchId ? { branchAssignments: { some: { branchId: activeBranchId } } } : undefined } }),
      this.prisma.specialty.count(),
    ]);
    return { selectedBranch, branches: navigation.branches, departments: navigation.departments, specialties: navigation.specialties, featuredDoctors: featuredDoctors.slice(0, 6), specialtyPackages: specialtyPackages.slice(0, 8), healthPackages: healthPackages.slice(0, 6), bookingMethods, stats: { doctorCount, branchCount: navigation.branches.length, specialtyCount, reviewCount: 0, averageRating: 5 } };
  }

  private async homepageSpecialtyPackages(branchId: string) {
    const rows = await this.prisma.servicePackage.findMany({
      where: {
        isActive: true,
        OR: [
          {
            branchBookingMethods: {
              some: {
                branchBookingMethod: {
                  branchId,
                  isEnabled: true,
                  bookingMethod: { code: 'SPECIALTY_EXAM', isActive: true },
                },
              },
            },
          },
          {
            branchBookingMethod: {
              branchId,
              isEnabled: true,
              bookingMethod: { code: 'SPECIALTY_EXAM', isActive: true },
            },
          },
        ],
      },
      orderBy: [{ specialty: { name: 'asc' } }, { price: 'asc' }],
      take: 8,
      select: {
        id: true,
        code: true,
        slug: true,
        name: true,
        description: true,
        price: true,
        durationMin: true,
        sessionType: true,
        activeDaysOfWeek: true,
        specialtyId: true,
        specialty: { select: { id: true, name: true, slug: true } },
        branchBookingMethod: { select: { branchId: true, branch: { select: { id: true, code: true, slug: true } } } },
        branchBookingMethods: { select: { branchBookingMethod: { select: { branchId: true, branch: { select: { id: true, code: true, slug: true } } } } } },
      },
    });
    return rows.map(({ branchBookingMethod, branchBookingMethods, ...item }) => {
      const bbm = branchBookingMethods?.find((l) => l.branchBookingMethod.branchId === branchId)?.branchBookingMethod || branchBookingMethod;
      return {
        ...item,
        branchId: bbm?.branchId || branchId,
        branchSlug: bbm?.branch?.slug ?? null,
      };
    });
  }

  departments(branchId: string) {
    return this.prisma.specialty.findMany({
      where: { branches: { some: { branchId, isActive: true } } },
      orderBy: { name: 'asc' }, select: { id: true, name: true, slug: true, description: true },
    });
  }

  async specialtyServices(branchIdentifier: string | undefined, specialtyId: number) {
    if (!Number.isInteger(specialtyId)) throw new BadRequestException('Thiếu chuyên khoa');
    const branchId = await this.resolveBranchId(branchIdentifier);
    const rows = await this.prisma.servicePackage.findMany({
      where: {
        specialtyId,
        isActive: true,
        OR: [
          {
            branchBookingMethods: {
              some: {
                branchBookingMethod: {
                  ...(branchId ? { branchId } : {}),
                  isEnabled: true,
                  bookingMethod: { isActive: true },
                },
              },
            },
          },
          {
            branchBookingMethod: {
              ...(branchId ? { branchId } : {}),
              isEnabled: true,
              bookingMethod: { isActive: true },
            },
          },
        ],
      },
      orderBy: [{ price: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        code: true,
        slug: true,
        name: true,
        description: true,
        price: true,
        durationMin: true,
        sessionType: true,
        activeDaysOfWeek: true,
        specialtyId: true,
        branchBookingMethod: { select: { id: true, branchId: true, bookingMethod: { select: { id: true, code: true, name: true } } } },
        branchBookingMethods: { select: { branchBookingMethod: { select: { id: true, branchId: true, bookingMethod: { select: { id: true, code: true, name: true } } } } } },
      },
    });
    return rows.map(({ branchBookingMethod, branchBookingMethods, ...service }) => {
      const bbm = branchBookingMethods?.find((l) => !branchId || l.branchBookingMethod.branchId === branchId)?.branchBookingMethod || branchBookingMethod;
      return {
        ...service,
        branchId: bbm?.branchId,
        branchBookingMethodId: bbm?.id,
        bookingMethod: bbm?.bookingMethod,
      };
    });
  }

  async servicePackageScheduleDates(packageIdentifier: string, branchIdentifier?: string) {
    if (!packageIdentifier) throw new BadRequestException('Thiếu gói dịch vụ');
    const isId = this.isUuid(packageIdentifier);
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
    const resolvedBranchId = branchIdentifier ? await this.resolveBranchId(branchIdentifier) : null;
    const branchId =
      resolvedBranchId ||
      servicePackage.branchBookingMethods?.[0]?.branchBookingMethod?.branchId ||
      servicePackage.branchBookingMethod?.branchId;
    if (!branchId) throw new BadRequestException('Không tìm thấy cơ sở y tế cho gói khám này');
    const specialtyId = servicePackage.specialtyId;
    const sessionType = (servicePackage as any).sessionType || 'ALL_DAY';
    const activeDays: number[] = (servicePackage as any).activeDaysOfWeek?.length
      ? (servicePackage as any).activeDaysOfWeek
      : [0, 1, 2, 3, 4, 5, 6];

    const { minDate, maxDate } = this.getBookingAllowedDateRange();
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

  async servicePackageTimeslots(packageIdentifier: string, date: string, branchIdentifier?: string) {
    if (!packageIdentifier) throw new BadRequestException('Thiếu gói dịch vụ');
    const isId = this.isUuid(packageIdentifier);
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
    const resolvedBranchId = branchIdentifier ? await this.resolveBranchId(branchIdentifier) : null;
    const branchId =
      resolvedBranchId ||
      servicePackage.branchBookingMethods?.[0]?.branchBookingMethod?.branchId ||
      servicePackage.branchBookingMethod?.branchId;
    if (!branchId) throw new BadRequestException('Không tìm thấy cơ sở y tế cho gói khám này');
    const specialtyId = servicePackage.specialtyId;
    const sessionType = (servicePackage as any).sessionType || 'ALL_DAY';
    const activeDays: number[] = (servicePackage as any).activeDaysOfWeek?.length
      ? (servicePackage as any).activeDaysOfWeek
      : [0, 1, 2, 3, 4, 5, 6];

    const workDate = this.parseDate(date);
    this.validateDateWithinBookingRange(workDate);

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
      const { schedule, ...slotData } = slot as any;
      const start = slot.startTime.toISOString().slice(11, 16);
      const end = slot.endTime.toISOString().slice(11, 16);

      // Lọc slot theo buổi tiếp nhận của gói khám
      if (sessionType === 'MORNING' && start >= '12:00') continue;
      if (sessionType === 'AFTERNOON' && (start < '12:00' || start >= '17:00')) continue;
      if (sessionType === 'EVENING' && start < '17:00') continue;
      if (sessionType === 'OFFICE_HOURS' && start >= '17:00') continue;

      const key = `${start}-${end}`;
      const docName = schedule.doctor?.academicRank
        ? `${schedule.doctor.academicRank} ${schedule.doctor.user?.fullName || ''}`.trim()
        : schedule.doctor?.user?.fullName || 'Bác sĩ trực khám';

      const isAvail = slot.slotStatus === 'AVAILABLE' && (slot.capacity - slot.occupiedCount > 0);
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

  async healthPackages(branchIdentifier?: string, limit?: number) {
    const branchId = await this.resolveBranchId(branchIdentifier);
    const rows = await this.prisma.servicePackage.findMany({
      where: {
        isActive: true,
        OR: [
          {
            branchBookingMethods: {
              some: {
                branchBookingMethod: {
                  ...(branchId ? { branchId } : {}),
                  isEnabled: true,
                  bookingMethod: { code: 'HEALTH_PACKAGE', isActive: true },
                },
              },
            },
          },
          {
            branchBookingMethod: {
              ...(branchId ? { branchId } : {}),
              isEnabled: true,
              bookingMethod: { code: 'HEALTH_PACKAGE', isActive: true },
            },
          },
        ],
      },
      orderBy: { name: 'asc' },
      ...(limit ? { take: limit } : {}),
      select: {
        id: true,
        code: true,
        slug: true,
        name: true,
        description: true,
        price: true,
        sessionType: true,
        activeDaysOfWeek: true,
        branchBookingMethod: { select: { id: true, branchId: true, branch: { select: { id: true, code: true, slug: true } } } },
        branchBookingMethods: { select: { branchBookingMethod: { select: { id: true, branchId: true, branch: { select: { id: true, code: true, slug: true } } } } } },
      },
    });
    return rows.map(({ branchBookingMethod, branchBookingMethods, ...healthPackage }) => {
      const bbm = branchBookingMethods?.find((l) => !branchId || l.branchBookingMethod.branchId === branchId)?.branchBookingMethod || branchBookingMethod;
      return {
        ...healthPackage,
        branchId: bbm?.branchId || branchId,
        branchSlug: bbm?.branch?.slug ?? null,
        branchBookingMethodId: bbm?.id,
      };
    });
  }

  async bookingMethods(branchIdentifier: string) {
    if (!branchIdentifier) throw new BadRequestException('Thiếu chi nhánh');
    const branchId = await this.resolveBranchId(branchIdentifier);
    return this.prisma.branchBookingMethod.findMany({
      where: { branchId, isEnabled: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, branchId: true, isEnabled: true, sortOrder: true, bookingMethod: { select: { id: true, code: true, name: true, description: true, route: true } } },
    }).then((rows) => rows.map(({ bookingMethod, ...item }) => ({ ...item, bookingMethodId: bookingMethod.id, type: bookingMethod.code, code: bookingMethod.code, displayName: bookingMethod.name, description: bookingMethod.description, route: bookingMethod.route })));
  }

  async doctors(branchIdentifier?: string, departmentId?: number, specialtyId?: number, q?: string, featuredOnly = false, limit?: number) {
    if (specialtyId !== undefined && !Number.isInteger(specialtyId)) throw new BadRequestException('specialtyId không hợp lệ');
    const branchId = await this.resolveBranchId(branchIdentifier);
    const term = q?.trim();
    const effectiveLimit = limit ?? (featuredOnly ? 6 : (term ? 30 : 50));
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
      take: effectiveLimit,
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
    const { minDate, maxDate } = this.getBookingAllowedDateRange();
    const schedules = await this.prisma.doctorSchedule.findMany({
      where: { doctorId, branchId, status: 'OPEN', workDate: { gte: minDate, lte: maxDate } },
      select: { workDate: true },
      orderBy: { workDate: 'asc' },
      take: 90,
    });
    return Array.from(new Set(schedules.map(({ workDate }) => workDate.toISOString().slice(0, 10))));
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
    const workDate = this.parseDate(date);
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

  async timeslots(doctorId: string, branchId: string, date: string) {
    const workDate = this.parseDate(date);
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

    // Quy định bệnh viện:
    // 1. Chỉ cho phép đặt lịch trực tuyến trước từ 1 đến 30 ngày (không cho đặt trong ngày).
    // 2. Nếu muốn khám ngày mai, phải đặt trước 16h30 hôm nay. Sau 16h30 hôm nay, ngày mai sẽ bị khóa trực tuyến.
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

  private today(): Date { const date = new Date(); date.setUTCHours(0, 0, 0, 0); return date; }
  private parseDate(value: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('Ngày phải có định dạng YYYY-MM-DD');
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) throw new BadRequestException('Ngày không hợp lệ');
    return date;
  }
}

