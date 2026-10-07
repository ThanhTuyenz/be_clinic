import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import { resolveBranchId } from '../../common/utils/booking-date-rules.utils.js';

export interface GetPackagesQueryDto {
  page?: number | string;
  limit?: number | string;
  branchId?: string;
  specialtyId?: number | string;
  search?: string;
  minPrice?: number | string;
  maxPrice?: number | string;
  sortBy?: string;
  type?: 'all' | 'health-package' | 'specialty';
  needPagination?: boolean;
}

@Injectable()
export class PackagesService {
  private readonly logger = new Logger(PackagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * GET /public/packages (Dùng cho cả public API và getHomepage)
   * Quản lý tập trung: lọc, phân trang Offset & Redis Caching Page 1 cho gói khám
   */
  async getPackages(query: GetPackagesQueryDto) {
    const needPagination = query.needPagination !== false;
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 6));
    const skip = (page - 1) * limit;

    const effectiveBranchId = await resolveBranchId(this.prisma, query.branchId);
    const specialtyId = query.specialtyId ? Number(query.specialtyId) : undefined;
    const search = query.search?.trim();
    const rawMin = query.minPrice !== undefined && query.minPrice !== '' ? Number(query.minPrice) : NaN;
    const minPrice = !isNaN(rawMin) ? rawMin : undefined;

    const rawMax = query.maxPrice !== undefined && query.maxPrice !== '' ? Number(query.maxPrice) : NaN;
    const maxPrice = !isNaN(rawMax) ? rawMax : undefined;

    const sortBy = query.sortBy || 'default';
    const type = query.type || 'all';

    // Page 1 Cache Key: Cache trang 1 khi không có từ khóa tìm kiếm tùy biến phức tạp
    const isCacheablePage1 = page === 1 && !search;
    const cacheKey = `cache:public:packages:p1:${effectiveBranchId || 'all'}:${specialtyId || 'all'}:${type}:${sortBy}:${minPrice ?? 'none'}:${maxPrice ?? 'none'}:${limit}`;

    if (isCacheablePage1 && this.redis.isEnabled()) {
      try {
        const cached = await this.redis.get<any>(cacheKey);
        if (cached) return cached;
      } catch (err: any) {
        this.logger.warn(`Redis get failed for packages cache: ${err?.message}`);
      }
    }

    const conditions: any[] = [{ isActive: true }];

    if (specialtyId) {
      conditions.push({ specialtyId });
    }

    if (search) {
      conditions.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { code: { contains: search, mode: 'insensitive' } },
          { specialty: { name: { contains: search, mode: 'insensitive' } } },
        ],
      });
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      const priceCondition: any = {};
      if (minPrice !== undefined) priceCondition.gte = minPrice;
      if (maxPrice !== undefined) priceCondition.lte = maxPrice;
      conditions.push({ price: priceCondition });
    }

    const bookingMethodCode =
      type === 'health-package' ? 'HEALTH_PACKAGE' : type === 'specialty' ? 'SPECIALTY_EXAM' : undefined;

    if (bookingMethodCode) {
      conditions.push({
        OR: [
          {
            branchBookingMethods: {
              some: {
                branchBookingMethod: {
                  ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}),
                  isEnabled: true,
                  bookingMethod: { code: bookingMethodCode, isActive: true },
                },
              },
            },
          },
          {
            branchBookingMethod: {
              ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}),
              isEnabled: true,
              bookingMethod: { code: bookingMethodCode, isActive: true },
            },
          },
        ],
      });
    } else if (effectiveBranchId) {
      conditions.push({
        OR: [
          {
            branchBookingMethods: {
              some: {
                branchBookingMethod: {
                  branchId: effectiveBranchId,
                  isEnabled: true,
                },
              },
            },
          },
          {
            branchBookingMethod: {
              branchId: effectiveBranchId,
              isEnabled: true,
            },
          },
        ],
      });
    }

    let orderBy: any = [{ specialty: { name: 'asc' } }, { price: 'asc' }];
    if (sortBy === 'price-asc') {
      orderBy = [{ price: 'asc' }];
    } else if (sortBy === 'price-desc') {
      orderBy = [{ price: 'desc' }];
    } else if (sortBy === 'name-asc') {
      orderBy = [{ name: 'asc' }];
    }

    const where = { AND: conditions };

    const packageSelect = {
      id: true,
      code: true,
      slug: true,
      name: true,
      description: true,
      notes: true,
      price: true,
      durationMin: true,
      sessionType: true,
      activeDaysOfWeek: true,
      specialtyId: true,
      specialty: { select: { id: true, name: true, slug: true } },
      branchBookingMethod: {
        select: {
          id: true,
          branchId: true,
          bookingMethod: { select: { id: true, code: true, name: true } },
          branch: { select: { id: true, code: true, slug: true, name: true } },
        },
      },
      branchBookingMethods: {
        select: {
          branchBookingMethod: {
            select: {
              id: true,
              branchId: true,
              bookingMethod: { select: { id: true, code: true, name: true } },
              branch: { select: { id: true, code: true, slug: true, name: true } },
            },
          },
        },
      },
    };

    let [total, rows] = await Promise.all([
      needPagination ? this.prisma.servicePackage.count({ where }) : Promise.resolve(0),
      this.prisma.servicePackage.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        select: packageSelect,
      }),
    ]);


    const formattedData = rows.map(({ branchBookingMethod, branchBookingMethods, ...item }) => {
      const bbm =
        branchBookingMethods?.find(
          (l) => !effectiveBranchId || l.branchBookingMethod.branchId === effectiveBranchId,
        )?.branchBookingMethod || branchBookingMethod;

      return {
        ...item,
        price: Number(item.price),
        branchId: bbm?.branchId || effectiveBranchId,
        branchSlug: bbm?.branch?.slug ?? null,
        branchBookingMethodId: bbm?.id,
        bookingMethod: bbm?.bookingMethod,
      };
    });

    const totalPages = needPagination ? Math.ceil(total / limit) : 1;

    const result = {
      data: formattedData,
      pagination: {
        page,
        limit,
        total: needPagination ? total : formattedData.length,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    };

    if (isCacheablePage1 && this.redis.isEnabled()) {
      try {
        await this.redis.set(cacheKey, result, 600); // 10 minutes TTL
      } catch (err: any) {
        this.logger.warn(`Redis set failed for packages cache: ${err?.message}`);
      }
    }

    return result;
  }

  /**
   * GET /services/:id (Hỗ trợ ID UUID, mã code hoặc slug)
   * Chi tiết đầy đủ 1 gói dịch vụ / gói khám phục vụ trang chi tiết riêng
   */
  async getServiceDetail(serviceIdentifier: string) {
    if (!serviceIdentifier) throw new NotFoundException('Thiếu định danh gói dịch vụ');
    const cleanId = serviceIdentifier.trim();
    const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanId);
    const upperId = cleanId.toUpperCase();
    const withPkgPrefix = upperId.startsWith('PKG-') ? upperId : `PKG-${upperId}`;
    const withoutPkgPrefix = upperId.startsWith('PKG-') ? upperId.slice(4) : upperId;

    const pkg = await this.prisma.servicePackage.findFirst({
      where: isId
        ? { id: cleanId, isActive: true }
        : {
            isActive: true,
            OR: [
              { slug: { equals: cleanId, mode: 'insensitive' } },
              { code: { equals: cleanId, mode: 'insensitive' } },
              { code: { equals: upperId, mode: 'insensitive' } },
              { code: { equals: withPkgPrefix, mode: 'insensitive' } },
              { code: { equals: withoutPkgPrefix, mode: 'insensitive' } },
            ],
          },
      include: {
        specialty: {
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
            iconUrl: true,
            doctors: {
              where: { doctor: { isActive: true } },
              take: 6,
              select: {
                isPrimary: true,
                doctor: {
                  select: {
                    id: true,
                    academicRank: true,
                    experienceYears: true,
                    biography: true,
                    avatarUrl: true,
                    consultationFee: true,
                    ratingAverage: true,
                    ratingCount: true,
                    user: { select: { fullName: true } },
                  },
                },
              },
            },
          },
        },
        branchBookingMethod: {
          include: {
            branch: {
              select: {
                id: true,
                code: true,
                slug: true,
                name: true,
                address: true,
                phoneNumber: true,
                operatingHours: true,
              },
            },
            bookingMethod: { select: { id: true, code: true, name: true, route: true } },
          },
        },
        branchBookingMethods: {
          include: {
            branchBookingMethod: {
              include: {
                branch: {
                  select: {
                    id: true,
                    code: true,
                    slug: true,
                    name: true,
                    address: true,
                    phoneNumber: true,
                    operatingHours: true,
                  },
                },
                bookingMethod: { select: { id: true, code: true, name: true, route: true } },
              },
            },
          },
        },
      },
    });

    if (!pkg) throw new NotFoundException('Không tìm thấy gói khám hoặc dịch vụ này');

    // Extract unique branches
    const branchMap = new Map<string, any>();
    if (pkg.branchBookingMethod?.branch) {
      branchMap.set(pkg.branchBookingMethod.branch.id, pkg.branchBookingMethod.branch);
    }
    for (const bbm of pkg.branchBookingMethods || []) {
      if (bbm.branchBookingMethod?.branch) {
        branchMap.set(bbm.branchBookingMethod.branch.id, bbm.branchBookingMethod.branch);
      }
    }
    const branchList = Array.from(branchMap.values());

    const doctors =
      pkg.specialty?.doctors?.map((d) => ({
        id: d.doctor.id,
        fullName: d.doctor.user?.fullName || '',
        academicRank: d.doctor.academicRank,
        experienceYears: d.doctor.experienceYears,
        biography: d.doctor.biography,
        avatarUrl: d.doctor.avatarUrl,
        consultationFee: Number(d.doctor.consultationFee) || 0,
        ratingAverage: Number(d.doctor.ratingAverage) || 5.0,
        ratingCount: d.doctor.ratingCount || 0,
        isPrimary: d.isPrimary,
      })) || [];

    const bbm = pkg.branchBookingMethods?.[0]?.branchBookingMethod || pkg.branchBookingMethod;

    return {
      id: pkg.id,
      code: pkg.code,
      slug: pkg.slug,
      name: pkg.name,
      imageUrl: pkg.imageUrl,
      description: pkg.description,
      notes: pkg.notes,
      symptoms: pkg.symptoms || [],
      price: Number(pkg.price),
      durationMin: pkg.durationMin,
      sessionType: pkg.sessionType,
      activeDaysOfWeek: pkg.activeDaysOfWeek,
      specialtyId: pkg.specialtyId,
      specialty: pkg.specialty
        ? {
            id: pkg.specialty.id,
            name: pkg.specialty.name,
            slug: pkg.specialty.slug,
            description: pkg.specialty.description,
            iconUrl: pkg.specialty.iconUrl,
          }
        : null,
      branchId: bbm?.branchId,
      branch: bbm?.branch,
      bookingMethod: bbm?.bookingMethod,
      branches: branchList,
      doctors,
    };
  }

  /**
   * GET /services/packages/specialty
   */
  async specialtyPackages(branchIdentifier?: string, limit?: number) {
    const res = await this.getPackages({
      branchId: branchIdentifier,
      type: 'specialty',
      limit: limit || 100,
      needPagination: false,
    });
    return res.data;
  }

  /**
   * GET /services/packages/health
   */
  async healthPackages(branchIdentifier?: string, limit?: number) {
    const res = await this.getPackages({
      branchId: branchIdentifier,
      type: 'health-package',
      limit: limit || 100,
      needPagination: false,
    });
    return res.data;
  }

  /**
   * GET /services?q=&specialtyId=&branchId=
   * Tìm kiếm gói dịch vụ tổng quát (specialtyId NULL)
   */
  async getGeneralServices(branchId?: string, q?: string) {
    const term = q?.trim();
    const effectiveBranchId = await resolveBranchId(this.prisma, branchId);
    const packages = await this.prisma.servicePackage.findMany({
      where: {
        specialtyId: null,
        isActive: true,
        branchBookingMethod: {
          isEnabled: true,
          bookingMethod: { isActive: true },
          ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}),
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
    });
    return packages.map(({ branchBookingMethod, ...pkg }) => ({
      ...pkg,
      price: Number(pkg.price),
      branchId: branchBookingMethod?.branchId,
      branchBookingMethodId: branchBookingMethod?.id,
      bookingMethod: branchBookingMethod?.bookingMethod,
    }));
  }
}
