import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { BookingInitDto } from './dtos/booking-init.dto.js';
import { BookingSlotsDto } from './dtos/booking-slots.dto.js';

@Injectable()
export class BookingFlowService {
  constructor(private readonly prisma: PrismaService) {}

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

  /**
   * API 1: Bootstrap dữ liệu theo từng luồng đặt khám (Facade / BFF)
   * GET /api/v1/booking/init?flow=...&branchId=...
   */
  async getBookingInit(dto: BookingInitDto) {
    const rawFlow = (dto.flow || 'all').toLowerCase().trim();
    const effectiveBranchId = await this.resolveBranchId(dto.branchId);
    const parsedSpecialtyId = dto.specialtyId ? Number(dto.specialtyId) : undefined;

    // 1. Dữ liệu dùng chung: Danh sách cơ sở & Phương thức đặt khám
    const [branches, bookingMethods] = await Promise.all([
      this.prisma.branch.findMany({
        where: { isActive: true },
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
    ]);

    const selectedBranch = effectiveBranchId
      ? branches.find((b) => b.id === effectiveBranchId) || null
      : branches[0] || null;

    // 2. Tùy biến gom dữ liệu chuẩn theo luồng (flow)
    if (rawFlow === 'doctor' || rawFlow === 'bac-si') {
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
          id: true,
          academicRank: true,
          experienceYears: true,
          biography: true,
          avatarUrl: true,
          consultationFee: true,
          ratingAverage: true,
          ratingCount: true,
          isFeatured: true,
          user: {
            select: {
              fullName: true,
              branchAssignments: {
                select: {
                  isPrimary: true,
                  branch: { select: { id: true, code: true, slug: true, name: true, address: true } },
                },
              },
            },
          },
          specialties: {
            select: {
              isPrimary: true,
              specialty: { select: { id: true, name: true, slug: true } },
            },
          },
        },
      });

      const formattedDoctors = doctors.map((d) => {
        const primarySpec = d.specialties.find((s) => s.isPrimary)?.specialty || d.specialties[0]?.specialty;
        const primaryBranch = d.user?.branchAssignments.find((b) => b.isPrimary)?.branch || d.user?.branchAssignments[0]?.branch;
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
          ratingAverage: Number(d.ratingAverage) || 5.0,
          ratingCount: d.ratingCount,
          isFeatured: d.isFeatured,
          branchId: primaryBranch?.id || '',
          specialtyID: primarySpec ? String(primarySpec.id) : '',
          specialtyName: primarySpec?.name || '',
          specialties: d.specialties.map((s) => ({
            id: s.specialty.id,
            name: s.specialty.name,
            slug: s.specialty.slug,
            isPrimary: s.isPrimary,
          })),
          branches: d.user?.branchAssignments.map((b) => b.branch) || [],
        };
      });

      // Lấy danh sách các chuyên khoa đại diện cho các bác sĩ này
      const specialtyMap = new Map<number, any>();
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
        branches,
        selectedBranch,
        bookingMethods,
        doctors: formattedDoctors,
        specialties: Array.from(specialtyMap.values()),
      };
    }

    if (rawFlow === 'specialty' || rawFlow === 'chuyen-khoa') {
      const specialties = await this.prisma.specialty.findMany({
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
          branches: {
            where: { isActive: true },
            select: {
              branch: { select: { id: true, code: true, slug: true, name: true } },
            },
          },
          _count: {
            select: {
              doctors: { where: { doctor: { isActive: true } } },
              servicePackages: { where: { isActive: true } },
            },
          },
        },
      });

      // Nếu có chọn chuyên khoa cụ thể, load sẵn danh sách gói khám của chuyên khoa đó
      let specialtyServices: any[] = [];
      if (parsedSpecialtyId) {
        const services = await this.prisma.servicePackage.findMany({
          where: {
            specialtyId: parsedSpecialtyId,
            isActive: true,
            branchBookingMethod: {
              isEnabled: true,
              bookingMethod: { isActive: true },
              ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}),
            },
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
            branchBookingMethod: {
              select: {
                branchId: true,
                branch: { select: { id: true, code: true, slug: true, name: true } },
                bookingMethod: { select: { id: true, code: true, name: true } },
              },
            },
          },
        });

        specialtyServices = services.map(({ branchBookingMethod, ...s }) => ({
          ...s,
          price: Number(s.price),
          branchId: branchBookingMethod?.branchId,
          branch: branchBookingMethod?.branch,
        }));
      }

      return {
        flow: 'specialty',
        branches,
        selectedBranch,
        bookingMethods,
        specialties: specialties.map(({ _count, branches: bList, ...s }) => ({
          ...s,
          doctorCount: _count?.doctors ?? 0,
          serviceCount: _count?.servicePackages ?? 0,
          branches: bList.map((b) => b.branch),
        })),
        services: specialtyServices,
      };
    }

    if (rawFlow === 'health-package' || rawFlow === 'goi-kham') {
      const packages = await this.prisma.servicePackage.findMany({
        where: {
          isActive: true,
          OR: [
            {
              branchBookingMethod: {
                isEnabled: true,
                bookingMethod: { code: 'HEALTH_PACKAGE', isActive: true },
                ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}),
              },
            },
            {
              specialtyId: null,
              branchBookingMethod: {
                isEnabled: true,
                ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}),
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
          branchBookingMethod: {
            select: {
              branchId: true,
              branch: { select: { id: true, code: true, slug: true, name: true, address: true } },
              bookingMethod: { select: { id: true, code: true, name: true } },
            },
          },
        },
      });

      return {
        flow: 'health-package',
        branches,
        selectedBranch,
        bookingMethods,
        healthPackages: packages.map(({ branchBookingMethod, ...pkg }) => ({
          ...pkg,
          price: Number(pkg.price),
          branchId: branchBookingMethod?.branchId,
          branch: branchBookingMethod?.branch,
          bookingMethod: branchBookingMethod?.bookingMethod,
        })),
      };
    }

    // Default / All / Facility flow: Trả về đầy đủ danh mục tổng quan cho wizard
    const [specialties, featuredDoctors, healthPackages] = await Promise.all([
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
        take: 30,
        orderBy: [{ isFeatured: 'desc' }, { ratingAverage: 'desc' }],
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
          user: { select: { fullName: true } },
          specialties: {
            select: {
              isPrimary: true,
              specialty: { select: { id: true, name: true, slug: true } },
            },
          },
        },
      }),
      this.prisma.servicePackage.findMany({
        where: {
          isActive: true,
          branchBookingMethod: {
            isEnabled: true,
            ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}),
          },
        },
        take: 30,
        orderBy: [{ price: 'asc' }],
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
          branchBookingMethod: {
            select: {
              branchId: true,
              branch: { select: { id: true, code: true, slug: true, name: true } },
              bookingMethod: { select: { id: true, code: true, name: true } },
            },
          },
        },
      }),
    ]);

    return {
      flow: 'facility',
      branches,
      selectedBranch,
      bookingMethods,
      specialties: specialties.map(({ _count, ...s }) => ({
        ...s,
        doctorCount: _count?.doctors ?? 0,
        serviceCount: _count?.servicePackages ?? 0,
      })),
      doctors: featuredDoctors.map((d) => {
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
      }),
      healthPackages: healthPackages.map(({ branchBookingMethod, ...pkg }) => ({
        ...pkg,
        price: Number(pkg.price),
        branchId: branchBookingMethod?.branchId,
        branch: branchBookingMethod?.branch,
        bookingMethod: branchBookingMethod?.bookingMethod,
      })),
    };
  }

  /**
   * API 2: Tính toán lịch & khung giờ khả dụng (Availability API)
   * GET /api/v1/booking/slots?branchId=...&specialtyId=...&doctorId=...&date=2026-10-05
   */
  async getBookingSlots(dto: BookingSlotsDto) {
    const effectiveBranchId = await this.resolveBranchId(dto.branchId);
    const parsedSpecialtyId = dto.specialtyId ? Number(dto.specialtyId) : undefined;
    const doctorId = dto.doctorId || undefined;
    const daysForward = Math.min(Math.max(Number(dto.days) || 30, 7), 60);

    // 1. Phân giải thông tin gói dịch vụ (nếu bệnh nhân đặt theo gói)
    let servicePackage: any = null;
    if (dto.servicePackageId) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dto.servicePackageId);
      servicePackage = await this.prisma.servicePackage.findFirst({
        where: isUuid
          ? { id: dto.servicePackageId, isActive: true }
          : { OR: [{ slug: dto.servicePackageId }, { code: dto.servicePackageId }], isActive: true },
        select: {
          id: true,
          specialtyId: true,
          sessionType: true,
          activeDaysOfWeek: true,
          branchBookingMethod: { select: { branchId: true } },
          branchBookingMethods: { select: { branchBookingMethod: { select: { branchId: true } } } },
        },
      });
    }

    const packageSpecialtyId = servicePackage?.specialtyId ?? undefined;
    const targetSpecialtyId = parsedSpecialtyId ?? packageSpecialtyId;
    const sessionType = (servicePackage as any)?.sessionType || 'ALL_DAY';
    const activeDays: number[] = (servicePackage as any)?.activeDaysOfWeek?.length
      ? (servicePackage as any).activeDaysOfWeek
      : [0, 1, 2, 3, 4, 5, 6];

    // 2. Tính khoảng ngày hợp lệ trong tương lai (30 ngày)
    const nowUtc = new Date();
    const vnOffsetMs = 7 * 60 * 60 * 1000;
    const nowVn = new Date(nowUtc.getTime() + vnOffsetMs);
    const todayVnStr = nowVn.toISOString().slice(0, 10);
    const [y, m, d] = todayVnStr.split('-').map(Number);

    const minDate = new Date(Date.UTC(y, m - 1, d)); // Kể từ hôm nay
    const maxDate = new Date(Date.UTC(y, m - 1, d + daysForward));

    // 3. Tìm danh sách tất cả các ngày có lịch khám khả dụng (Available Dates)
    const activeSchedules = await this.prisma.doctorSchedule.findMany({
      where: {
        status: 'OPEN',
        workDate: { gte: minDate, lte: maxDate },
        ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}),
        ...(doctorId ? { doctorId } : {}),
        ...(targetSpecialtyId
          ? { doctor: { specialties: { some: { specialtyId: targetSpecialtyId } } } }
          : {}),
        slots: {
          some: {
            isActive: true,
            slotStatus: 'AVAILABLE',
          },
        },
      },
      select: {
        workDate: true,
        slots: {
          where: { isActive: true, slotStatus: 'AVAILABLE' },
          select: { startTime: true, capacity: true, occupiedCount: true },
        },
      },
      orderBy: { workDate: 'asc' },
    });

    const availableDateSet = new Set<string>();
    for (const schedule of activeSchedules) {
      const dayOfWeek = schedule.workDate.getDay();
      if (!activeDays.includes(dayOfWeek)) continue;

      // Lọc theo sessionType nếu là gói khám
      const hasValidSlot = schedule.slots.some((s) => {
        if (s.capacity - s.occupiedCount <= 0) return false;
        const timeStr = s.startTime.toISOString().slice(11, 16);
        if (sessionType === 'MORNING') return timeStr < '12:00';
        if (sessionType === 'AFTERNOON') return timeStr >= '12:00' && timeStr < '17:00';
        if (sessionType === 'EVENING') return timeStr >= '17:00';
        if (sessionType === 'OFFICE_HOURS') return timeStr < '17:00';
        return true;
      });

      if (hasValidSlot) {
        availableDateSet.add(schedule.workDate.toISOString().slice(0, 10));
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

    const [ty, tm, td] = targetDateStr.split('-').map(Number);
    const targetWorkDate = new Date(Date.UTC(ty, tm - 1, td, 0, 0, 0, 0));

    // Truy vấn tất cả khung giờ của ngày này
    const slots = await this.prisma.doctorScheduleSlot.findMany({
      where: {
        isActive: true,
        slotStatus: 'AVAILABLE',
        schedule: {
          status: 'OPEN',
          workDate: targetWorkDate,
          ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}),
          ...(doctorId ? { doctorId } : {}),
          ...(targetSpecialtyId
            ? { doctor: { specialties: { some: { specialtyId: targetSpecialtyId } } } }
            : {}),
        },
      },
      include: {
        schedule: {
          select: {
            id: true,
            branchId: true,
            branch: { select: { id: true, code: true, slug: true, name: true } },
            room: { select: { id: true, code: true, name: true } },
            doctor: {
              select: {
                id: true,
                academicRank: true,
                consultationFee: true,
                avatarUrl: true,
                user: { select: { fullName: true } },
              },
            },
          },
        },
      },
      orderBy: [{ startTime: 'asc' }],
    });

    // 5. Tự động gộp theo khung giờ (startTime - endTime) và tính sẵn số chỗ trống
    const timeSlotMap = new Map<
      string,
      {
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
          consultationFee: number;
          roomId?: string | null;
          roomName?: string | null;
          remainingSlots: number;
        }>;
      }
    >();

    for (const slot of slots) {
      const start = slot.startTime.toISOString().slice(11, 16);
      const end = slot.endTime.toISOString().slice(11, 16);

      // Lọc theo sessionType của gói khám
      if (sessionType === 'MORNING' && start >= '12:00') continue;
      if (sessionType === 'AFTERNOON' && (start < '12:00' || start >= '17:00')) continue;
      if (sessionType === 'EVENING' && start < '17:00') continue;
      if (sessionType === 'OFFICE_HOURS' && start >= '17:00') continue;

      const key = `${start}-${end}`;
      const remainingForThisDoc = Math.max(0, slot.capacity - slot.occupiedCount);

      let period: 'MORNING' | 'AFTERNOON' | 'EVENING' = 'MORNING';
      if (start >= '12:00' && start < '17:00') {
        period = 'AFTERNOON';
      } else if (start >= '17:00') {
        period = 'EVENING';
      }

      const docInfo = {
        slotId: slot.id,
        doctorId: slot.schedule.doctor.id,
        doctorName: slot.schedule.doctor.user?.fullName || 'Bác sĩ',
        academicRank: slot.schedule.doctor.academicRank,
        consultationFee: Number(slot.schedule.doctor.consultationFee) || 0,
        roomId: slot.schedule.room?.id || null,
        roomName: slot.schedule.room?.name || null,
        remainingSlots: remainingForThisDoc,
      };

      if (!timeSlotMap.has(key)) {
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
        const existing = timeSlotMap.get(key)!;
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

    // Tính tổng kết ca sáng/chiều/tối
    const summary = {
      morning: calculatedSlots.filter((s) => s.period === 'MORNING' && !s.isFull).length,
      afternoon: calculatedSlots.filter((s) => s.period === 'AFTERNOON' && !s.isFull).length,
      evening: calculatedSlots.filter((s) => s.period === 'EVENING' && !s.isFull).length,
    };

    return {
      date: targetDateStr,
      availableDates,
      totalAvailableSlots: calculatedSlots.filter((s) => !s.isFull).length,
      summary,
      slots: calculatedSlots,
    };
  }
}
