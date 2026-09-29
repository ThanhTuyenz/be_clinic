import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js'
import { parseDate as parseDateUtil } from '../../common/utils/staff.utils.js'

@Injectable()
export class SpecialtiesService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveBranchId(identifier?: string): Promise<string | undefined> {
    if (!identifier) return undefined;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier)) return identifier;
    const branch = await this.prisma.branch.findFirst({
      where: { OR: [{ slug: identifier }, { code: identifier }], isActive: true },
      select: { id: true },
    });
    return branch?.id ?? identifier;
  }

  /**
   * GET /specialties
   * Danh sách tất cả chuyên khoa đang hoạt động
   */
  async getSpecialties(branchId?: string) {
    const effectiveBranchId = await this.resolveBranchId(branchId);
    const specialties = await this.prisma.specialty.findMany({
      where: {
        ...(effectiveBranchId
          ? { branches: { some: { branchId: effectiveBranchId, isActive: true } } }
          : {}),
      } as any,
      orderBy: [{ id: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        _count: {
          select: {
            doctors: { where: { doctor: { isActive: true } } },
            servicePackages: { where: { isActive: true } },
          },
        },
      } as any,
    })
    return (specialties as any[]).map(({ _count, ...s }) => ({
      ...s,
      doctorCount: _count?.doctors ?? 0,
      serviceCount: _count?.servicePackages ?? 0,
    }))
  }

  /**
   * GET /specialties/:id
   * Chi tiết 1 chuyên khoa
   */
  async getSpecialtyById(id: number) {
    const specialty = await this.prisma.specialty.findFirst({
      where: { id } as any,
      include: {
        branches: {
          where: { isActive: true },
          select: { branchId: true, branch: { select: { id: true, code: true, slug: true, name: true, address: true } } },
        },
      },
    })
    if (!specialty) throw new NotFoundException('Không tìm thấy chuyên khoa')
    return specialty
  }

  /**
   * GET /specialties/:id/services
   * Gói khám / dịch vụ thuộc chuyên khoa (NULL specialtyId = gói tổng quát)
   */
  async getSpecialtyServices(specialtyId: number, branchId?: string) {
    const effectiveBranchId = await this.resolveBranchId(branchId);
    const packages = await this.prisma.servicePackage.findMany({
      where: {
        specialtyId,
        isActive: true,
        branchBookingMethod: {
          isEnabled: true,
          bookingMethod: { isActive: true },
          ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}),
        },
      },
      orderBy: [{ price: 'asc' }, { name: 'asc' }],
      take: 60,
      select: {
        id: true,
        code: true,
        slug: true,
        name: true,
        description: true,
        price: true,
        durationMin: true,
        specialtyId: true,
        branchBookingMethod: {
          select: {
            id: true,
            branchId: true,
            branch: { select: { id: true, code: true, slug: true } },
            bookingMethod: { select: { id: true, code: true, name: true, route: true } },
          },
        },
      },
    })
    return packages.map(({ branchBookingMethod, ...pkg }) => ({
      ...pkg,
      branchId: branchBookingMethod.branchId,
      branchSlug: branchBookingMethod.branch?.slug ?? null,
      branchBookingMethodId: branchBookingMethod.id,
      bookingMethod: branchBookingMethod.bookingMethod,
      price: Number(pkg.price),
    }))
  }


  /**
   * GET /specialties/:id/doctors
   * Bác sĩ thuộc chuyên khoa
   */
  async getSpecialtyDoctors(specialtyId: number, branchId?: string, q?: string) {
    const effectiveBranchId = await this.resolveBranchId(branchId);
    const term = q?.trim()
    const doctors = await this.prisma.doctor.findMany({
      where: {
        isActive: true,
        specialties: { some: { specialtyId } },
        user: {
          ...(term ? { fullName: { contains: term, mode: 'insensitive' } } : {}),
          ...(effectiveBranchId ? { branchAssignments: { some: { branchId: effectiveBranchId } } } : {}),
        },
      },
      orderBy: [{ isFeatured: 'desc' }, { ratingAverage: 'desc' }, { user: { fullName: 'asc' } }],
      take: 50,
      select: {
        id: true,
        academicRank: true,
        experienceYears: true,
        biography: true,
        avatarUrl: true,
        consultationFee: true,
        ratingAverage: true,
        ratingCount: true,
        isFeatured: true,
        specialties: {
          select: {
            isPrimary: true,
            specialty: { select: { id: true, name: true, slug: true } },
          },
        },
        user: {
          select: {
            fullName: true,
            branchAssignments: {
              where: effectiveBranchId ? { branchId: effectiveBranchId } : undefined,
              select: {
                isPrimary: true,
                branch: { select: { id: true, code: true, slug: true, name: true, address: true } },
              },
            },
          },
        },
      },
    })
    return doctors.map(({ user, ...doctor }) => ({
      ...doctor,
      fullName: user.fullName || 'Bác sĩ',
      consultationFee: Number(doctor.consultationFee),
      branchAssignments: user.branchAssignments,
    }))
  }

  /**
   * GET /services/:id
   * Chi tiết 1 gói dịch vụ / gói khám
   */
  async getServiceDetail(serviceId: string) {
    const pkg = await this.prisma.servicePackage.findFirst({
      where: { id: serviceId, isActive: true },
      include: {
        specialty: { select: { id: true, name: true, iconUrl: true } },
        branchBookingMethod: {
          include: {
            branch: { select: { id: true, name: true, address: true, phoneNumber: true } },
            bookingMethod: { select: { id: true, code: true, name: true, route: true } },
          },
        },
      },
    })
    if (!pkg) throw new NotFoundException('Không tìm thấy dịch vụ')
    const { branchBookingMethod, ...rest } = pkg
    return {
      ...rest,
      price: Number(rest.price),
      branchId: branchBookingMethod.branch.id,
      branch: branchBookingMethod.branch,
      branchBookingMethodId: branchBookingMethod.id,
      bookingMethod: branchBookingMethod.bookingMethod,
      schedules: [],
    }
  }

  /**
   * GET /services?q=&specialtyId=&branchId=
   * Tìm kiếm gói dịch vụ tổng quát (specialtyId NULL)
   */
  async getGeneralServices(branchId?: string, q?: string) {
    const term = q?.trim()
    const packages = await this.prisma.servicePackage.findMany({
      where: {
        specialtyId: null,
        isActive: true,
        branchBookingMethod: {
          isEnabled: true,
          bookingMethod: { isActive: true },
          ...(branchId ? { branchId } : {}),
        },
        ...(term ? { name: { contains: term, mode: 'insensitive' } } : {}),
      },
      orderBy: { name: 'asc' },
      take: 60,
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        price: true,
        durationMin: true,
        branchBookingMethod: {
          select: {
            id: true,
            branchId: true,
            bookingMethod: { select: { id: true, code: true, name: true } },
          },
        },
      },
    })
    return packages.map(({ branchBookingMethod, ...pkg }) => ({
      ...pkg,
      price: Number(pkg.price),
      branchId: branchBookingMethod.branchId,
      branchBookingMethodId: branchBookingMethod.id,
      bookingMethod: branchBookingMethod.bookingMethod,
    }))
  }

  /**
   * GET /public/specialties
   */
  async specialties() {
    return this.prisma.specialty.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true, description: true, branches: { where: { isActive: true }, select: { branchId: true } } },
    });
  }

  async specialtyServices(branchIdentifier: string | undefined, specialtyId: number) {
    if (!Number.isInteger(specialtyId)) throw new NotFoundException('Thiếu chuyên khoa');
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
      take: 60,
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
        price: Number(service.price),
        branchId: bbm?.branchId,
        branchBookingMethodId: bbm?.id,
        bookingMethod: bbm?.bookingMethod,
      };
    });
  }

  async specialtyPackages(branchIdentifier?: string, limit?: number) {
    const branchId = await this.resolveBranchId(branchIdentifier);
    let rows = await this.prisma.servicePackage.findMany({
      where: {
        isActive: true,
        OR: [
          {
            branchBookingMethods: {
              some: {
                branchBookingMethod: {
                  ...(branchId ? { branchId } : {}),
                  isEnabled: true,
                  bookingMethod: { code: 'SPECIALTY_EXAM', isActive: true },
                },
              },
            },
          },
          {
            branchBookingMethod: {
              ...(branchId ? { branchId } : {}),
              isEnabled: true,
              bookingMethod: { code: 'SPECIALTY_EXAM', isActive: true },
            },
          },
        ],
      },
      orderBy: [{ specialty: { name: 'asc' } }, { price: 'asc' }],
      ...(limit ? { take: limit } : {}),
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
        branchBookingMethod: { select: { id: true, branchId: true, branch: { select: { id: true, code: true, slug: true } } } },
        branchBookingMethods: { select: { branchBookingMethod: { select: { id: true, branchId: true, branch: { select: { id: true, code: true, slug: true } } } } } },
      },
    });

    if (rows.length === 0 && branchId) {
      rows = await this.prisma.servicePackage.findMany({
        where: {
          isActive: true,
          OR: [
            {
              branchBookingMethods: {
                some: {
                  branchBookingMethod: {
                    isEnabled: true,
                    bookingMethod: { code: 'SPECIALTY_EXAM', isActive: true },
                  },
                },
              },
            },
            {
              branchBookingMethod: {
                isEnabled: true,
                bookingMethod: { code: 'SPECIALTY_EXAM', isActive: true },
              },
            },
          ],
        },
        orderBy: [{ specialty: { name: 'asc' } }, { price: 'asc' }],
        ...(limit ? { take: limit } : {}),
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
          branchBookingMethod: { select: { id: true, branchId: true, branch: { select: { id: true, code: true, slug: true } } } },
          branchBookingMethods: { select: { branchBookingMethod: { select: { id: true, branchId: true, branch: { select: { id: true, code: true, slug: true } } } } } },
        },
      });
    }

    return rows.map(({ branchBookingMethod, branchBookingMethods, ...item }) => {
      const bbm = branchBookingMethods?.find((l) => !branchId || l.branchBookingMethod.branchId === branchId)?.branchBookingMethod || branchBookingMethod;
      return {
        ...item,
        price: Number(item.price),
        branchId: bbm?.branchId || branchId,
        branchSlug: bbm?.branch?.slug ?? null,
        branchBookingMethodId: bbm?.id,
      };
    });
  }

  async healthPackages(branchIdentifier?: string, limit?: number) {
    const branchId = await this.resolveBranchId(branchIdentifier);
    let rows = await this.prisma.servicePackage.findMany({
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

    if (rows.length === 0 && branchId) {
      rows = await this.prisma.servicePackage.findMany({
        where: {
          isActive: true,
          OR: [
            {
              branchBookingMethods: {
                some: {
                  branchBookingMethod: {
                    isEnabled: true,
                    bookingMethod: { code: 'HEALTH_PACKAGE', isActive: true },
                  },
                },
              },
            },
            {
              branchBookingMethod: {
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
    }

    return rows.map(({ branchBookingMethod, branchBookingMethods, ...healthPackage }) => {
      const bbm = branchBookingMethods?.find((l) => !branchId || l.branchBookingMethod.branchId === branchId)?.branchBookingMethod || branchBookingMethod;
      return {
        ...healthPackage,
        price: Number(healthPackage.price),
        branchId: bbm?.branchId || branchId,
        branchSlug: bbm?.branch?.slug ?? null,
        branchBookingMethodId: bbm?.id,
      };
    });
  }

  async servicePackageScheduleDates(packageIdentifier: string, branchIdentifier?: string) {
    if (!packageIdentifier) throw new NotFoundException('Thiếu gói dịch vụ');
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
    const resolvedBranchId = branchIdentifier ? await this.resolveBranchId(branchIdentifier) : null;
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
    if (!packageIdentifier) throw new NotFoundException('Thiếu gói dịch vụ');
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
    const resolvedBranchId = branchIdentifier ? await this.resolveBranchId(branchIdentifier) : null;
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

    const workDate = parseDateUtil(date) ?? new Date(`${date}T00:00:00.000Z`);
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
      throw new NotFoundException(
        'Hệ thống không nhận đặt lịch trực tuyến trong ngày. Để khám trong ngày hôm nay, quý khách vui lòng đến trực tiếp phòng khám để lấy số thứ tự tại quầy tiếp đón.',
      );
    }
    if (diffDays > 30) {
      throw new NotFoundException('Hệ thống chỉ mở đặt lịch trực tuyến trước tối đa 30 ngày.');
    }
    if (diffDays === 1) {
      const isPastCutoff = currentHour > 16 || (currentHour === 16 && currentMinute >= 30);
      if (isPastCutoff) {
        throw new NotFoundException(
          'Để khám vào ngày mai, quý khách vui lòng hoàn tất đặt lịch trước 16h30 hôm nay. Quý khách vui lòng chọn ngày khám khác hoặc đến lấy số trực tiếp tại quầy tiếp đón.',
        );
      }
    }
  }

}
