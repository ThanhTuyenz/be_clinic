import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import { PackagesService } from './packages.service.js';
import { resolveBranchId } from '../../common/utils/booking-date-rules.utils.js';

@Injectable()
export class SpecialtiesService {
  private readonly logger = new Logger(SpecialtiesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly packagesService: PackagesService,
  ) {}

  /**
   * GET /specialties
   * Danh sách tất cả chuyên khoa đang hoạt động
   */
  async getSpecialties(branchId?: string) {
    const effectiveBranchId = await resolveBranchId(this.prisma, branchId);
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
    });
    return (specialties as any[]).map(({ _count, ...s }) => ({
      ...s,
      doctorCount: _count?.doctors ?? 0,
      serviceCount: _count?.servicePackages ?? 0,
    }));
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
    });
    if (!specialty) throw new NotFoundException('Không tìm thấy chuyên khoa');
    return specialty;
  }

  /**
   * GET /specialties/:id/services
   * Gói khám / dịch vụ thuộc chuyên khoa
   */
  async getSpecialtyServices(specialtyId: number, branchId?: string) {
    const effectiveBranchId = await resolveBranchId(this.prisma, branchId);
    const packages = await this.prisma.servicePackage.findMany({
      where: {
        specialtyId,
        isActive: true,
        OR: [
          {
            branchBookingMethods: {
              some: {
                branchBookingMethod: {
                  ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}),
                  isEnabled: true,
                  bookingMethod: { isActive: true },
                },
              },
            },
          },
          {
            branchBookingMethod: {
              ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}),
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
        specialtyId: true,
        branchBookingMethod: {
          select: {
            id: true,
            branchId: true,
            branch: { select: { id: true, code: true, slug: true } },
            bookingMethod: { select: { id: true, code: true, name: true, route: true } },
          },
        },
        branchBookingMethods: {
          select: {
            branchBookingMethod: {
              select: {
                id: true,
                branchId: true,
                branch: { select: { id: true, code: true, slug: true } },
                bookingMethod: { select: { id: true, code: true, name: true, route: true } },
              },
            },
          },
        },
      },
    });

    return packages.map(({ branchBookingMethod, branchBookingMethods, ...pkg }) => {
      const bbm =
        branchBookingMethods?.find(
          (l) => !effectiveBranchId || l.branchBookingMethod.branchId === effectiveBranchId,
        )?.branchBookingMethod || branchBookingMethod;

      return {
        ...pkg,
        branchId: bbm?.branchId,
        branchSlug: bbm?.branch?.slug ?? null,
        branchBookingMethodId: bbm?.id,
        bookingMethod: bbm?.bookingMethod,
        price: Number(pkg.price),
      };
    });
  }

  /**
   * GET /specialties/:id/doctors
   * Bác sĩ thuộc chuyên khoa
   */
  async getSpecialtyDoctors(specialtyId: number, branchId?: string, q?: string) {
    const effectiveBranchId = await resolveBranchId(this.prisma, branchId);
    const term = q?.trim();
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
    });
    return doctors.map(({ user, ...doctor }) => ({
      ...doctor,
      fullName: user.fullName || 'Bác sĩ',
      consultationFee: Number(doctor.consultationFee),
      branchAssignments: user.branchAssignments,
    }));
  }

  /**
   * GET /public/navigation
   */
  async getNavigation() {
    const [specialties, branches] = await Promise.all([
      this.getSpecialties(),
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
        },
      }),
    ]);
    return {
      departments: [],
      specialties,
      branches,
    };
  }

  /**
   * GET /public/homepage
   * Tổng hợp trang chủ BFF kèm multi-tier Redis Caching
   */
  async getHomepage(branchIdentifier?: string) {
    const effectiveBranchId = await resolveBranchId(this.prisma, branchIdentifier);
    const cacheKey = `cache:public:homepage:${effectiveBranchId || 'all'}`;

    if (this.redis.isEnabled()) {
      try {
        const cached = await this.redis.get<any>(cacheKey);
        if (cached) {
          return cached;
        }
      } catch (err: any) {
        this.logger.warn(`Redis get failed for homepage cache: ${err?.message}`);
      }
    }

    const [specialties, branches, healthPackagesRes, specialtyPackagesRes, featuredDoctors] = await Promise.all([
      this.getSpecialties(),
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
          latitude: true,
          longitude: true,
        },
      }),
      this.packagesService.getPackages({ type: 'health-package', limit: 12, needPagination: false }),
      this.packagesService.getPackages({ type: 'specialty', limit: 12, needPagination: false }),
      this.prisma.doctor.findMany({
        where: {
          isActive: true,
          isFeatured: true,
          ...(effectiveBranchId
            ? { user: { branchAssignments: { some: { branchId: effectiveBranchId } } } }
            : {}),
        },
        take: 8,
        orderBy: [{ ratingAverage: 'desc' }],
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
    ]);

    const selectedBranch = branches.find((b) => b.id === effectiveBranchId) || branches[0] || null;

    const result = {
      departments: [],
      specialties,
      branches,
      selectedBranch,
      featuredDoctors: featuredDoctors.map((d) => ({
        id: d.id,
        fullName: d.user?.fullName || '',
        academicRank: d.academicRank,
        experienceYears: d.experienceYears,
        biography: d.biography,
        consultationFee: Number(d.consultationFee) || 0,
        avatarUrl: d.avatarUrl,
        ratingAverage: Number(d.ratingAverage) || 5.0,
        ratingCount: d.ratingCount,
        isFeatured: d.isFeatured,
        specialties: d.specialties,
        branchAssignments: [],
      })),
      specialtyPackages: specialtyPackagesRes.data || [],
      healthPackages: healthPackagesRes.data || [],
      bookingMethods: [],
      stats: {
        doctorCount: featuredDoctors.length,
        branchCount: branches.length,
        specialtyCount: specialties.length,
        reviewCount: 0,
        averageRating: 5.0,
      },
    };

    if (this.redis.isEnabled()) {
      try {
        await this.redis.set(cacheKey, result, 600); // 10 minutes cache
      } catch (err: any) {
        this.logger.warn(`Redis set failed for homepage cache: ${err?.message}`);
      }
    }

    return result;
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

  /**
   * Alias for specialty services query
   */
  async specialtyServices(branchIdentifier: string | undefined, specialtyId: number) {
    if (!Number.isInteger(specialtyId)) throw new NotFoundException('Thiếu chuyên khoa');
    return this.getSpecialtyServices(specialtyId, branchIdentifier);
  }
}
