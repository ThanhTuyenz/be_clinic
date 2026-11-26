import { PACKAGE_DEPLOYMENT_SELECT, getPackageDeployments, packageDeploymentWhere } from '../bookings/helpers/package-deployment.helper.js';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import { resolveBranchId } from '../../common/utils/booking-date-rules.utils.js';
import { mapPackageForRetrieval } from '../../infrastructure/embedding/embedding.service.js';
import { SearchRankingService } from '../search/services/search-ranking.service.js';

export interface GetPackagesQueryDto {
  page?: number | string;
  limit?: number | string;
  branchId?: number | string;
  specialtyId?: number | string;
  search?: string;
  /** Internal caller option; public search keeps hybrid ranking by default. */
  searchMode?: 'hybrid' | 'lexical';
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
    private readonly searchRanking: SearchRankingService,
  ) {}

  /**
   * GET /public/packages (Dùng cho cả public API và getHomepage)
   * Quản lý tập trung: lọc, phân trang Offset & Redis Caching Page 1 cho gói khám
   */
  async getPackages(query: GetPackagesQueryDto) {
    const needPagination = query.needPagination !== false;
    const page = Math.max(1, Number(query.page) || 1);
    const limit = query.needPagination === false ? 500 : Math.min(200, Math.max(1, Number(query.limit) || 6));
    const skip = needPagination ? (page - 1) * limit : 0;

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
    const cacheKey = `cache:public:packages:p1:v3:${effectiveBranchId || 'all'}:${specialtyId || 'all'}:${type}:${sortBy}:${minPrice ?? 'none'}:${maxPrice ?? 'none'}:${limit}`;

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

    if (minPrice !== undefined || maxPrice !== undefined) {
      const priceCondition: any = {};
      if (minPrice !== undefined) priceCondition.gte = minPrice;
      if (maxPrice !== undefined) priceCondition.lte = maxPrice;
      conditions.push({ price: priceCondition });
    }

    const bookingMethodCode =
      type === 'health-package' ? 'HEALTH_PACKAGE' : type === 'specialty' ? 'SPECIALTY_EXAM' : undefined;

    conditions.push(await packageDeploymentWhere(this.prisma, effectiveBranchId, bookingMethodCode));

    let orderBy: any = [{ specialty: { name: 'asc' } }, { price: 'asc' }];
    if (sortBy === 'price-asc') {
      orderBy = [{ price: 'asc' }];
    } else if (sortBy === 'price-desc') {
      orderBy = [{ price: 'desc' }];
    } else if (sortBy === 'name-asc') {
      orderBy = [{ name: 'asc' }];
    } else if (sortBy === 'views-desc') {
      orderBy = [{ viewCount: 'desc' }, { id: 'asc' }];
    }

    const where = { AND: conditions };

    // Use the same retrieval rules as the search suggestions. Only lightweight
    // metadata is ranked; deployment details are fetched for the requested page.
    let rankedIds: number[] | undefined;
    if (search) {
      const candidates = await this.prisma.servicePackage.findMany({
        where,
        select: {
          id: true, code: true, name: true, description: true, symptoms: true,
          price: true, durationMin: true, specialtyId: true,
          targetGender: true, minAge: true, maxAge: true, isFollowUp: true,
          specialty: { select: { name: true, description: true, symptoms: true } },
        },
      });
      const ranked = await this.searchRanking.rank(
        search, candidates.map(mapPackageForRetrieval), candidates.length,
        { semantic: query.searchMode !== 'lexical' },
      );
      rankedIds = ranked.map(item => item.package.id);
      conditions.push({ id: { in: rankedIds } });
    }

    const packageSelect = {
      id: true,
      isFeatured: true,
      viewCount: true,
      code: true,
      slug: true,
      name: true,
      imageUrl: true,
      description: true,
      notes: true,
      symptoms: true,
      price: true,
      durationMin: true,
      receptionSchedules: { where: { isActive: true }, select: { branchId: true, dayOfWeek: true, sessions: true } },
      specialtyId: true,
      specialty: { select: { id: true, name: true, slug: true } },

      ...PACKAGE_DEPLOYMENT_SELECT,
    };

    const rankPage = rankedIds !== undefined && sortBy === 'default'
      ? rankedIds.slice(skip, skip + limit) : undefined;
    let [total, rows] = await Promise.all([
      rankedIds !== undefined ? Promise.resolve(rankedIds.length)
        : needPagination ? this.prisma.servicePackage.count({ where }) : Promise.resolve(0),
      this.prisma.servicePackage.findMany({
        where: rankPage ? { AND: [where, { id: { in: rankPage } }] } : where,
        orderBy,
        skip: rankPage ? 0 : skip,
        take: limit,
        select: packageSelect,
      }),
    ]);

    if (rankPage) {
      const positions = new Map(rankPage.map((id, index) => [id, index]));
      rows.sort((a, b) => positions.get(a.id)! - positions.get(b.id)!);
    }


    const formattedData = rows.map((row) => {
      const { branches, bookingMethod, ...item } = row;
      const deployments = getPackageDeployments(row)
        .filter((method) => method.isEnabled && method.bookingMethod.isActive && method.branch.isActive
          && (!effectiveBranchId || method.branchId === effectiveBranchId)
          && (!bookingMethodCode || method.bookingMethod.code === bookingMethodCode));
      const bbm = deployments[0];

      return {
        ...item,
        price: Number(item.price),
        branchId: bbm?.branchId,
        branchSlug: bbm?.branch?.slug ?? null,
        bookingMethod: bbm?.bookingMethod,
        bookingMethods: [...new Map(deployments.map((method) => [method.id, { branchId: method.branchId, ...method.bookingMethod }])).values()],
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
        await this.redis.set(cacheKey, result, sortBy === 'views-desc' ? 60 : 600);
      } catch (err: any) {
        this.logger.warn(`Redis set failed for packages cache: ${err?.message}`);
      }
    }

    return result;
  }

  /**
   * GET /services/:id (Hỗ trợ ID số, mã code hoặc slug)
   * Chi tiết đầy đủ 1 gói dịch vụ / gói khám phục vụ trang chi tiết riêng
   */
  async getServiceDetail(serviceIdentifier: string) {
    if (!serviceIdentifier) throw new NotFoundException('Thiếu định danh gói dịch vụ');
    const cleanId = serviceIdentifier.trim();
    const isId = /^\d+$/.test(cleanId) && Number.isSafeInteger(Number(cleanId)) && Number(cleanId) > 0;
    const upperId = cleanId.toUpperCase();
    const withPkgPrefix = upperId.startsWith('PKG-') ? upperId : `PKG-${upperId}`;
    const withoutPkgPrefix = upperId.startsWith('PKG-') ? upperId.slice(4) : upperId;
    const legacyBasicCode = /^CONSULT-.*-FOLLOWUP$/.test(withoutPkgPrefix)
      ? withoutPkgPrefix.replace(/-FOLLOWUP$/, '-BASIC') : undefined;

    const pkg = await this.prisma.servicePackage.findFirst({
      where: isId
        ? { id: Number(cleanId), isActive: true }
        : {
            isActive: true,
            OR: [
              { slug: { equals: cleanId, mode: 'insensitive' } },
              { code: { equals: cleanId, mode: 'insensitive' } },
              { code: { equals: upperId, mode: 'insensitive' } },
              { code: { equals: withPkgPrefix, mode: 'insensitive' } },
              { code: { equals: withoutPkgPrefix, mode: 'insensitive' } },
              ...(legacyBasicCode ? [{ code: { equals: legacyBasicCode, mode: 'insensitive' as const } }] : []),
            ],
          },
      select: {
        id: true,
        code: true,
        slug: true,
        name: true,
        imageUrl: true,
        description: true,
        notes: true,
        symptoms: true,
        price: true,
        durationMin: true,
        specialtyId: true,
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
                    user: { select: { fullName: true } },
                  },
                },
              },
            },
          },
        },

        receptionSchedules: { where: { isActive: true }, select: { branchId: true, dayOfWeek: true, sessions: true } },
        ...PACKAGE_DEPLOYMENT_SELECT,
      },
    });

    if (!pkg) throw new NotFoundException('Không tìm thấy gói khám hoặc dịch vụ này');

    const deployments = getPackageDeployments(pkg)
      .filter((method) => method.isEnabled && method.bookingMethod.isActive && method.branch.isActive);
    const branchList = [...new Map(deployments.map((method) => [method.branchId, method.branch])).values()];

    const doctors =
      pkg.specialty?.doctors?.map((d) => ({
        id: d.doctor.id,
        fullName: d.doctor.user?.fullName || '',
        academicRank: d.doctor.academicRank,
        experienceYears: d.doctor.experienceYears,
        biography: d.doctor.biography,
        avatarUrl: d.doctor.avatarUrl,
        consultationFee: Number(d.doctor.consultationFee) || 0,
        isPrimary: d.isPrimary,
      })) || [];

    const bbm = deployments[0];

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
      receptionSchedules: pkg.receptionSchedules,
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
      bookingMethods: [...new Map(deployments.map((method) => [method.id, { branchId: method.branchId, ...method.bookingMethod }])).values()],
      doctors,
    };
  }

  /**
   * GET /services/packages/specialty
   */
  async specialtyPackages(branchIdentifier?: string | number, limit?: number) {
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
  async healthPackages(branchIdentifier?: string | number, limit?: number) {
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
  async getGeneralServices(branchId?: number, q?: string) {
    const result = await this.getPackages({ branchId, search: q, type: 'health-package', needPagination: false });
    return result.data.filter((pkg) => pkg.specialtyId === null).slice(0, 60);

  }
}
