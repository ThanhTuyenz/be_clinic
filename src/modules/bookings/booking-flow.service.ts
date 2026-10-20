import { clinicPeriod } from '../../common/constants/clinic-sessions.js';
import { bookingMethodAcceptsSlot, packageAcceptsSlot } from './helpers/package-reception.helper.js';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { BookingInitDto } from './dtos/booking-init.dto.js';
import { BookingSlotsDto } from './dtos/booking-slots.dto.js';

const BOOKING_DOCTOR_SELECT = {
  id: true,
  academicRank: true,
  experienceYears: true,
  biography: true,
  avatarUrl: true,
  consultationFee: true,
  onlineConsultationFee: true,
  ratingAverage: true,
  ratingCount: true,
  isFeatured: true,
  user: { select: { fullName: true } },
  specialties: {
    select: {
      isPrimary: true,
      specialty: { select: { id: true, name: true, slug: true } },
    },
  },
} satisfies Prisma.DoctorSelect;

const PACKAGE_DEPLOYMENT_SELECT = {
  branchId: true,
  isEnabled: true,
  branch: { select: { id: true, code: true, slug: true, name: true, address: true, isActive: true } },
  bookingMethod: { select: { id: true, code: true, name: true, isActive: true } },
} satisfies Prisma.BranchBookingMethodSelect;

type BookingDoctor = Prisma.DoctorGetPayload<{ select: typeof BOOKING_DOCTOR_SELECT }>;

const BOOKING_SLOT_PACKAGE_SELECT = {
  id: true,
  specialtyId: true,
  receptionSchedules: { select: { branchId: true, dayOfWeek: true, sessions: true } },
  branchBookingMethod: { select: { branchId: true, isEnabled: true, bookingMethod: { select: { code: true, isActive: true } } } },
  branchBookingMethods: { select: { branchBookingMethod: { select: { branchId: true, isEnabled: true, bookingMethod: { select: { code: true, isActive: true } } } } } },
} satisfies Prisma.ServicePackageSelect;

type BookingSlotPackage = Prisma.ServicePackageGetPayload<{ select: typeof BOOKING_SLOT_PACKAGE_SELECT }>;

const BOOKING_SLOT_INCLUDE = {
  schedule: {
    select: {
      id: true,
      workDate: true,
      branchId: true,
      branch: { select: { id: true, code: true, slug: true, name: true } },
      room: { select: { id: true, code: true, name: true } },
      doctor: {
        select: {
          id: true,
          academicRank: true,
          consultationFee: true,
          onlineConsultationFee: true,
          avatarUrl: true,
          experienceYears: true,
          user: { select: { fullName: true } },
        },
      },
    },
  },
} satisfies Prisma.DoctorScheduleSlotInclude;

type BookingSlot = Prisma.DoctorScheduleSlotGetPayload<{ include: typeof BOOKING_SLOT_INCLUDE }>;
type BookingTimeSlot = {
  startTime: string;
  endTime: string;
  label: string;
  period: 'MORNING' | 'AFTERNOON' | 'EVENING';
  totalCapacity: number;
  occupiedCount: number;
  remainingSlots: number;
  isFull: boolean;
  representativeSlotId: string;
  doctors: Array<{
    slotId: string;
    doctorId: string;
    doctorName: string;
    academicRank?: string | null;
    avatarUrl?: string | null;
    experienceYears?: number | null;
    consultationFee: number;
    onlineConsultationFee: number;
    roomId?: string | null;
    roomName?: string | null;
    remainingSlots: number;
  }>;
};

@Injectable()
export class BookingFlowService {
  constructor(private readonly prisma: PrismaService) { }

  // API 1: dữ liệu theo từng luồng đặt khám (Facade / BFF)

  async getBookingInit(dto: BookingInitDto) {
    const rawFlow = (dto.flow || 'all').toLowerCase().trim();
    const effectiveBranchId = await this.resolveBranchId(dto.branchId);
    const parsedSpecialtyId = await this.resolveSpecialtyId(dto.specialtyId);

    const methodCodeMap: Record<string, string> = {
      specialty: 'SPECIALTY_EXAM',
      'chuyen-khoa': 'SPECIALTY_EXAM',
      doctor: 'CONSULTATION',
      'bac-si': 'CONSULTATION',
      'online-consultation': 'ONLINE_CONSULTATION',
      online: 'ONLINE_CONSULTATION',
      'health-package': 'HEALTH_PACKAGE',
      'goi-kham': 'HEALTH_PACKAGE',
      'after-hours': 'AFTER_HOURS',
      'ngoai-gio': 'AFTER_HOURS',
      followup: 'CONSULTATION',
    };
    const requiredMethodCode = methodCodeMap[rawFlow];

    const branchWhere: Prisma.BranchWhereInput = {
      isActive: true,
      bookingMethods: {
        some: {
          isEnabled: true,
          bookingMethod: {
            ...(requiredMethodCode ? { code: requiredMethodCode } : {}),
            isActive: true,
          },
        },
      },
    };

    // 1. Dữ liệu dùng chung: Danh sách cơ sở, Phương thức đặt khám & Tất cả gói dịch vụ/khám sức khỏe
    const [branches, bookingMethods, allServicePackages] = await Promise.all([
      this.prisma.branch.findMany({
        where: branchWhere,
        orderBy: [{ code: 'desc' }, { name: 'asc' }],
        select: {
          id: true,
          code: true,
          slug: true,
          name: true,
          address: true,
          phoneNumber: true,
          imageUrl: true,
          latitude: true,
          longitude: true,
        },
      }),
      this.prisma.bookingMethod.findMany({
        where: { isActive: true },
        select: {
          id: true,
          code: true,
          name: true,
          description: true,
          route: true,
        },
      }),
      this.prisma.servicePackage.findMany({
        where: {
          isActive: true,
          OR: [
            {
              branchBookingMethod: {
                isEnabled: true,
                bookingMethod: { isActive: true },
              },
            },
            {
              branchBookingMethods: {
                some: {
                  branchBookingMethod: {
                    isEnabled: true,
                    bookingMethod: { isActive: true },
                  },
                },
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
          receptionSchedules: { select: { branchId: true, dayOfWeek: true, sessions: true } },
          specialtyId: true,
          branchBookingMethod: {
            select: PACKAGE_DEPLOYMENT_SELECT,
          },
          branchBookingMethods: {
            where: {
              branchBookingMethod: {
                isEnabled: true,
                bookingMethod: { isActive: true },
              },
            },
            select: {
              branchBookingMethod: {
                select: PACKAGE_DEPLOYMENT_SELECT,
              },
            },
          },
        },
      }),
    ]);

    const formatPackages = (methodCode: string) => allServicePackages
      .map(({ branchBookingMethod, branchBookingMethods, ...pkg }) => {
        const primaryBbm =
          branchBookingMethod?.isEnabled && branchBookingMethod.branch.isActive && branchBookingMethod?.bookingMethod?.isActive
          && branchBookingMethod.bookingMethod.code === methodCode
            ? branchBookingMethod
            : null;
        const validLinks = (branchBookingMethods || [])
          .map((b) => b.branchBookingMethod)
          .filter((bbm) => bbm && bbm.isEnabled && bbm.branch.isActive && bbm.bookingMethod?.isActive
            && bbm.bookingMethod.code === methodCode);

        const branchesList = [
          ...(primaryBbm?.branch ? [primaryBbm.branch] : []),
          ...validLinks.map((l) => l.branch).filter(Boolean),
        ];

        // Deduplicate branches by id
        const uniqueBranches = Array.from(new Map(branchesList.map((b) => [b.id, b])).values());
        const deployments = [...(primaryBbm ? [primaryBbm] : []), ...validLinks];
        const effectiveBbm = deployments.find((method) => !effectiveBranchId || method.branchId === effectiveBranchId) || null;

        return {
          ...pkg,
          price: Number(pkg.price),
          branchId: effectiveBbm?.branchId,
          branch: effectiveBbm?.branch,
          branches: uniqueBranches,
          bookingMethod: effectiveBbm?.bookingMethod,
        };
      })
      .filter((pkg) => pkg.branches.length > 0);

    const specialtyPackages = formatPackages(requiredMethodCode || 'SPECIALTY_EXAM').filter((p) =>
      p.specialtyId !== null &&
      (parsedSpecialtyId === undefined || p.specialtyId === parsedSpecialtyId) &&
      (!effectiveBranchId || p.branches.some((branch) => branch.id === effectiveBranchId)),
    );
    const generalHealthPackages = formatPackages('HEALTH_PACKAGE').filter((p) => !effectiveBranchId || p.branches.some((branch) => branch.id === effectiveBranchId));

    const selectedBranch = effectiveBranchId
      ? branches.find((b) => b.id === effectiveBranchId) || null
      : null;
    const commonData = { branches, selectedBranch, bookingMethods };
    const packageData = {
      services: specialtyPackages,
      healthPackages: generalHealthPackages,
    };

    // 2. Tùy biến gom dữ liệu chuẩn theo luồng (flow)
    if (rawFlow === 'doctor' || rawFlow === 'bac-si' || rawFlow === 'online-consultation' || rawFlow === 'online' || rawFlow === 'followup') {
      const doctors = await this.prisma.doctor.findMany({
        where: {
          isActive: true,
          ...(effectiveBranchId
            ? { user: { branchAssignments: { some: { branchId: effectiveBranchId } } } }
            : {}),
          ...(parsedSpecialtyId
            ? { specialties: { some: { specialtyId: parsedSpecialtyId } } }
            : {}),
        },
        orderBy: [{ isFeatured: 'desc' }, { ratingAverage: 'desc' }, { user: { fullName: 'asc' } }],
        select: {
          ...BOOKING_DOCTOR_SELECT,
          user: {
            select: {
              fullName: true,
              branchAssignments: {
                select: {
                  isPrimary: true,
                  branch: { select: { id: true, code: true, slug: true, name: true, address: true, isActive: true } },
                },
              },
            },
          },
        },
      });

      const formattedDoctors = doctors.filter((d) => d.user.branchAssignments.length === 1 && d.user.branchAssignments[0].branch.isActive).map((d) => {
        const primaryBranch = d.user.branchAssignments[0].branch;
        return {
          ...this.formatBookingDoctor(d),
          branchId: primaryBranch?.id || '',
          branches: d.user?.branchAssignments.map((b) => b.branch) || [],
        };
      });

      // Lấy danh sách các chuyên khoa đại diện cho các bác sĩ này
      const specialtyMap = new Map<number, {
        id: number; name: string; slug: string | null; doctorCount: number;
      }>();
      for (const doc of formattedDoctors) {
        for (const spec of doc.specialties) {
          if (!specialtyMap.has(spec.id)) {
            specialtyMap.set(spec.id, {
              id: spec.id,
              name: spec.name,
              slug: spec.slug,
              doctorCount: 1,
            });
          } else {
            specialtyMap.get(spec.id).doctorCount += 1;
          }
        }
      }

      return {
        flow: 'doctor',
        bookingMethodCode: requiredMethodCode || 'CONSULTATION',
        ...commonData,
        doctors: formattedDoctors,
        specialties: Array.from(specialtyMap.values()),
        services: [],
        healthPackages: [],
      };
    }

    if (rawFlow === 'specialty' || rawFlow === 'chuyen-khoa' || rawFlow === 'after-hours' || rawFlow === 'ngoai-gio') {
      const specialtyMethodCode = requiredMethodCode || 'SPECIALTY_EXAM';
      const specialties = await this.prisma.specialty.findMany({
        where: {
          isActive: true,
          branches: {
            some: {
              ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}),
              isActive: true,
              branch: {
                bookingMethods: {
                  some: {
                    isEnabled: true,
                    bookingMethod: { code: specialtyMethodCode, isActive: true },
                  },
                },
              },
            },
          },
        },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          iconUrl: true,
          branches: {
            where: {
              isActive: true,
              branch: {
                isActive: true,
                bookingMethods: {
                  some: {
                    isEnabled: true,
                    bookingMethod: { code: specialtyMethodCode, isActive: true },
                  },
                },
              },
            },
            select: {
              branch: { select: { id: true, code: true, slug: true, name: true } },
            },
          },
          _count: {
            select: {
              doctors: { where: { doctor: { isActive: true } } },
              servicePackages: {
                where: {
                  isActive: true,
                  OR: [
                    {
                      branchBookingMethod: {
                        isEnabled: true,
                        bookingMethod: { code: specialtyMethodCode, isActive: true },
                      },
                    },
                    {
                      branchBookingMethods: {
                        some: {
                          branchBookingMethod: {
                            isEnabled: true,
                            bookingMethod: { code: specialtyMethodCode, isActive: true },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      });

      return {
        flow: 'specialty',
        bookingMethodCode: requiredMethodCode || 'SPECIALTY_EXAM',
        ...commonData,
        specialties: specialties.map(({ _count, branches: bList, ...s }) => ({
          ...s,
          doctorCount: _count?.doctors ?? 0,
          serviceCount: _count?.servicePackages ?? 0,
          branches: bList.map((b) => b.branch),
        })),
        ...packageData,
      };
    }

    if (rawFlow === 'health-package' || rawFlow === 'goi-kham') {
      return {
        flow: 'health-package',
        bookingMethodCode: 'HEALTH_PACKAGE',
        ...commonData,
        ...packageData,
      };
    }

    // Default / All / Facility flow: Trả về đầy đủ danh mục tổng quan cho wizard
    const [specialties, featuredDoctors] = await Promise.all([
      this.prisma.specialty.findMany({
        where: {
          isActive: true,
          ...(effectiveBranchId
            ? { branches: { some: { branchId: effectiveBranchId, isActive: true } } }
            : {}),
        },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          iconUrl: true,
          _count: {
            select: {
              doctors: { where: { doctor: { isActive: true } } },
              servicePackages: { where: { isActive: true } },
            },
          },
        },
      }),
      this.prisma.doctor.findMany({
        where: {
          isActive: true,
          ...(effectiveBranchId
            ? { user: { branchAssignments: { some: { branchId: effectiveBranchId } } } }
            : {}),
        },
        take: 50,
        orderBy: [{ isFeatured: 'desc' }, { ratingAverage: 'desc' }],
        select: BOOKING_DOCTOR_SELECT,
      }),
    ]);

    return {
      flow: 'facility',
      bookingMethodCode: requiredMethodCode || 'SPECIALTY_EXAM',
      ...commonData,
      specialties: specialties.map(({ _count, ...s }) => ({
        ...s,
        doctorCount: _count?.doctors ?? 0,
        serviceCount: _count?.servicePackages ?? 0,
      })),
      doctors: featuredDoctors.map(doctor => this.formatBookingDoctor(doctor)),
      ...packageData,
    };
  }

// khung giừo khả dụng
  async getBookingSlots(dto: BookingSlotsDto) {
    const effectiveBranchId = await this.resolveBranchId(dto.branchId);
    const parsedSpecialtyId = await this.resolveSpecialtyId(dto.specialtyId);
    const doctorId = dto.doctorId || undefined;
    const daysForward = Math.min(Math.max(Number(dto.days) || 30, 7), 60);
    const servicePackage = await this.resolveBookingSlotPackage(dto.servicePackageId, effectiveBranchId, dto.bookingMethodCode);
    const packageSpecialtyId = servicePackage?.specialtyId ?? undefined;
    if (parsedSpecialtyId !== undefined && packageSpecialtyId !== undefined && parsedSpecialtyId !== packageSpecialtyId) {
      throw new BadRequestException('Dịch vụ khám không thuộc chuyên khoa đã chọn');
    }
    const targetSpecialtyId = parsedSpecialtyId ?? packageSpecialtyId;
    const bookingDates = this.getBookingDateRange(daysForward);
    const { minDate, maxDate } = bookingDates;
    const slotWhere: Prisma.DoctorScheduleSlotWhereInput = {
      isActive: true,
      slotStatus: 'AVAILABLE',
    };
    const scheduleWhere: Prisma.DoctorScheduleWhereInput = {
      status: 'OPEN',
      ...(dto.bookingMethodCode ? { branch: { bookingMethods: { some: { isEnabled: true, bookingMethod: { code: dto.bookingMethodCode, isActive: true } } } } } : {}),
      ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}),
      ...(doctorId ? { doctorId } : {}),
      doctor: {
        isActive: true,
        ...(targetSpecialtyId ? { specialties: { some: { specialtyId: targetSpecialtyId } } } : {}),
      },
    };

    const activeSchedules = await this.prisma.doctorSchedule.findMany({
      where: {
        ...scheduleWhere,
        workDate: { gte: minDate, lte: maxDate },
        slots: {
          some: slotWhere,
        },
      },
      select: {
        workDate: true,
        branchId: true,
        slots: {
          where: slotWhere,
          select: { startTime: true, capacity: true, occupiedCount: true },
        },
      },
      orderBy: { workDate: 'asc' },
    });

    const availableDateSet = new Set<string>();
    for (const schedule of activeSchedules) {
      const scheduleDateStr = schedule.workDate.toISOString().slice(0, 10);
      const hasValidSlot = schedule.slots.some((slot) =>
        slot.capacity > slot.occupiedCount && bookingMethodAcceptsSlot(dto.bookingMethodCode, { schedule }) && (!servicePackage || packageAcceptsSlot(
          servicePackage.receptionSchedules, schedule.branchId, schedule.workDate, slot.startTime,
        )),
      );

      if (hasValidSlot) {
        availableDateSet.add(scheduleDateStr);
      }
    }

    const availableDates = Array.from(availableDateSet).sort();

    // 4. Nếu truyền ngày cụ thể (hoặc mặc định ngày khả dụng gần nhất)
    const targetDateStr = dto.date || availableDates[0];
    if (!targetDateStr) {
      return {
        date: null,
        availableDates: [],
        totalAvailableSlots: 0,
        summary: { morning: 0, afternoon: 0, evening: 0 },
        slots: [],
      };
    }

    const { requestedDate, endOfTargetDate } = bookingDates.resolveDate(targetDateStr);

    const slots = await this.prisma.doctorScheduleSlot.findMany({
      where: {
        ...slotWhere,
        schedule: {
          ...scheduleWhere,
          workDate: { gte: requestedDate, lte: endOfTargetDate },
        },
      },
      include: BOOKING_SLOT_INCLUDE,
      orderBy: [{ startTime: 'asc' }],
    });

    return {
      date: targetDateStr,
      availableDates,
      ...this.formatBookingSlots(slots, servicePackage, dto.bookingMethodCode),
    };
  }

  /**
   * Phân giải identifier (UUID, slug hoặc code) thành branchId chuẩn
   */
  private async resolveBranchId(identifier?: string): Promise<string | undefined> {
    if (!identifier) return undefined;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier)) {
      return identifier;
    }
    const branch = await this.prisma.branch.findFirst({
      where: { OR: [{ slug: identifier }, { code: identifier }], isActive: true },
      select: { id: true },
    });
    return branch?.id ?? identifier;
  }

  private async resolveSpecialtyId(identifier?: string): Promise<number | undefined> {
    if (!identifier) return undefined;
    const value = identifier.trim();
    if (/^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0) return Number(value);
    const specialty = await this.prisma.specialty.findFirst({
      where: { slug: { equals: value, mode: 'insensitive' }, isActive: true }, select: { id: true },
    });
    if (!specialty) throw new NotFoundException('Không tìm thấy chuyên khoa phù hợp.');
    return specialty.id;
  }

  private formatBookingDoctor(d: BookingDoctor) {
    const primarySpec = d.specialties.find((s) => s.isPrimary)?.specialty || d.specialties[0]?.specialty;
    const fullName = d.user?.fullName || 'Bác sĩ';
    return {
      id: d.id,
      fullName,
      displayName: fullName,
      academicRank: d.academicRank,
      experienceYears: d.experienceYears,
      biography: d.biography,
      avatarUrl: d.avatarUrl,
      consultationFee: Number(d.consultationFee) || 0,
      onlineConsultationFee: Number(d.onlineConsultationFee ?? d.consultationFee) || 0,
      ratingAverage: Number(d.ratingAverage) || 5.0,
      ratingCount: d.ratingCount,
      isFeatured: d.isFeatured,
      specialtyID: primarySpec ? String(primarySpec.id) : '',
      specialtyName: primarySpec?.name || '',
      specialties: d.specialties.map((s) => ({
        id: s.specialty.id,
        name: s.specialty.name,
        slug: s.specialty.slug,
        isPrimary: s.isPrimary,
      })),
    };
  }

  private getBookingDateRange(daysForward: number) {
    const nowVn = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const [year, month, day] = nowVn.toISOString().slice(0, 10).split('-').map(Number);
    // Không đặt trong ngày; từ 16:30 chỉ nhận lịch từ ngày mốt.
    const minLeadDays = nowVn.getUTCHours() > 16 || (nowVn.getUTCHours() === 16 && nowVn.getUTCMinutes() >= 30) ? 2 : 1;
    const minDate = new Date(Date.UTC(year, month - 1, day + minLeadDays));
    const maxDate = new Date(Date.UTC(year, month - 1, day + daysForward));

    return {
      minDate,
      maxDate,
      resolveDate(value: string) {
        const [year, month, day] = value.split('-').map(Number);
        const requestedDate = new Date(Date.UTC(year, month - 1, day));
        if (Number.isNaN(requestedDate.getTime()) || requestedDate.toISOString().slice(0, 10) !== value || requestedDate < minDate || requestedDate > maxDate) {
          throw new BadRequestException('Ngày khám nằm ngoài khoảng thời gian cho phép');
        }
        return {
          requestedDate,
          endOfTargetDate: new Date(requestedDate.getTime() + 24 * 60 * 60 * 1000 - 1),
        };
      },
    };
  }

  private formatBookingSlots(slots: BookingSlot[], servicePackage: BookingSlotPackage | null, bookingMethodCode?: string) {
    const timeSlotMap = new Map<string, BookingTimeSlot>();
    for (const slot of slots) {
      if (!bookingMethodAcceptsSlot(bookingMethodCode, slot)) continue;
      const start = slot.startTime.toISOString().slice(11, 16);
      const end = slot.endTime.toISOString().slice(11, 16);

      if (servicePackage && !packageAcceptsSlot(
        servicePackage.receptionSchedules, slot.schedule.branchId, slot.schedule.workDate, slot.startTime,
      )) continue;

      const key = `${start}-${end}`;
      const remainingForThisDoc = Math.max(0, slot.capacity - slot.occupiedCount);

      const period = clinicPeriod(start);

      const docInfo = {
        slotId: slot.id,
        doctorId: slot.schedule.doctor.id,
        doctorName: slot.schedule.doctor.user?.fullName || 'Bác sĩ',
        academicRank: slot.schedule.doctor.academicRank,
        avatarUrl: slot.schedule.doctor.avatarUrl,
        experienceYears: slot.schedule.doctor.experienceYears,
        consultationFee: Number(slot.schedule.doctor.consultationFee) || 0,
        onlineConsultationFee: Number(slot.schedule.doctor.onlineConsultationFee ?? slot.schedule.doctor.consultationFee) || 0,
        roomId: slot.schedule.room?.id || null,
        roomName: slot.schedule.room?.name || null,
        remainingSlots: remainingForThisDoc,
      };

      const existing = timeSlotMap.get(key);
      if (!existing) {
        timeSlotMap.set(key, {
          startTime: start,
          endTime: end,
          label: `${start} - ${end}`,
          period,
          totalCapacity: slot.capacity,
          occupiedCount: slot.occupiedCount,
          remainingSlots: remainingForThisDoc,
          isFull: remainingForThisDoc <= 0,
          representativeSlotId: slot.id,
          doctors: [docInfo],
        });
      } else {
        existing.totalCapacity += slot.capacity;
        existing.occupiedCount += slot.occupiedCount;
        existing.remainingSlots += remainingForThisDoc;
        existing.isFull = existing.remainingSlots <= 0;
        existing.doctors.push(docInfo);
      }
    }

    const calculatedSlots = Array.from(timeSlotMap.values()).sort((a, b) =>
      a.startTime.localeCompare(b.startTime),
    );

    const summary = { morning: 0, afternoon: 0, evening: 0 };
    const periodKeys = { MORNING: 'morning', AFTERNOON: 'afternoon', EVENING: 'evening' } as const;
    let totalAvailableSlots = 0;
    for (const slot of calculatedSlots) {
      if (slot.isFull) continue;
      totalAvailableSlots += 1;
      summary[periodKeys[slot.period]] += 1;
    }
    return { totalAvailableSlots, summary, slots: calculatedSlots };
  }

  private async resolveBookingSlotPackage(identifier?: string, branchId?: string, bookingMethodCode?: string): Promise<BookingSlotPackage | null> {
    if (!identifier) return null;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
    const servicePackage = await this.prisma.servicePackage.findFirst({
      where: uuid
        ? { id: identifier, isActive: true }
        : { OR: [{ slug: identifier }, { code: identifier }], isActive: true },
      select: BOOKING_SLOT_PACKAGE_SELECT,
    });
    if (!servicePackage) throw new NotFoundException('Gói khám không khả dụng');
    const deployments = [servicePackage.branchBookingMethod, ...servicePackage.branchBookingMethods.map(link => link.branchBookingMethod)]
      .filter(method => method?.isEnabled && (!bookingMethodCode || (method.bookingMethod?.isActive && method.bookingMethod.code === bookingMethodCode)));
    const allowedBranches = new Set(deployments.map(method => method.branchId));
    if (!allowedBranches.size || (branchId && !allowedBranches.has(branchId))) {
      throw new NotFoundException('Gói khám không được áp dụng tại cơ sở đã chọn');
    }
    return {
      ...servicePackage,
      receptionSchedules: servicePackage.receptionSchedules.filter(day => allowedBranches.has(day.branchId)),
    };
  }

}
