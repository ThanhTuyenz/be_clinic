import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { containsSearchPhrase, matchesSearchConstraints, normalizeSearch, parseSearchIntent, searchTextScore } from '../../../common/utils/search-query.js';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import { RedisService } from '../../../infrastructure/redis/redis.service.js';
import { EmbeddingService, PackageForRetrieval } from '../../../infrastructure/embedding/embedding.service.js';
import { SearchAnalyticsService } from '../../search-analytics/search-analytics.service.js';
import { vietnamDateKey } from '../../search-analytics/analytics-time.js';
import { BehaviorTelemetryService } from './behavior-telemetry.service.js';
import { TrackingActionType } from '../recommendation.dto.js';

export interface SemanticSearchResult {
  query: string;
  searchId?: string;
  branchId?: string;
  total: number;
  partial?: boolean;
  packages: Array<{
    id: string;
    code: string;
    name: string;
    price: number;
    durationMin: number;
    specialtyName: string;
    similarityScore: number;
    description: string;
    branchId?: string;
    bookingMethodCode?: string;
    specialtyId?: number | null;
  }>;
  doctors: Array<{
    id: string;
    fullName: string;
    academicRank: string;
    specialties: string[];
    experienceYears: number;
    avatarUrl: string | null;
    ratingAverage: number;
  }>;
  branches: Array<{
    id: string;
    code: string;
    name: string;
    address: string;
    phoneNumber: string | null;
  }>;
}

@Injectable()
export class SemanticSearchService {
  private readonly logger = new Logger(SemanticSearchService.name);
  private readonly PACKAGES_CACHE_TTL_SECONDS = 300; // 5 phút cache danh sách gói khám ứng viên

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly embeddingService: EmbeddingService,
    private readonly analytics: SearchAnalyticsService,
    private readonly behaviorTelemetry: BehaviorTelemetryService,
  ) { }

  /**
   * Tìm kiếm thông minh đa thực thể (Gói khám, Bác sĩ, Cơ sở) bằng Vector Embeddings & Heuristic Matcher
   */
  async semanticSearchPackages(query: string, branchId?: string, context: { sessionId?: string; accountId?: string } = {}): Promise<SemanticSearchResult> {
    const start = performance.now();
    let result: SemanticSearchResult;
    try {
      result = await this.runSearch(query, branchId);
    } catch (error) {
      await this.analytics.recordSearch(query, context, null, performance.now() - start).catch(() => this.logger.warn('Không thể lưu lỗi tìm kiếm'));
      throw error;
    }
    result.searchId = await this.analytics.recordSearch(query, context, result, performance.now() - start)
      .catch(() => { this.logger.warn('Không thể lưu lượt tìm kiếm'); return undefined; });
    if (!result.partial && query.trim().length >= 2 && (context.sessionId || context.accountId)) {
      const specialties = [...new Set(result.packages.map(pkg => pkg.specialtyId).filter((id): id is number => typeof id === 'number'))];
      await this.behaviorTelemetry.trackUserBehavior({
        sessionId: context.sessionId, actionType: TrackingActionType.SEARCH, searchQuery: query.trim(),
        targetSpecialtyId: specialties.length === 1 ? specialties[0] : undefined,
      }, context.accountId).catch(() => this.logger.debug('Không thể cập nhật hành vi tìm kiếm'));
    }
    return result;
  }

  private async runSearch(query: string, branchId?: string): Promise<SemanticSearchResult> {
    if (!query || !query.trim()) {
      return { query: '', total: 0, packages: [], doctors: [], branches: [] };
    }
    const originalQuery = query.trim();
    let q = originalQuery;
    // Resolve an explicitly named branch before retrieving candidates.
    const availableBranches = await this.prisma.branch.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, address: true, phoneNumber: true },
    });
    if (!branchId && /\b(co so|chi nhanh)\b/.test(normalizeSearch(q))) {
      const matches = availableBranches.filter(branch => {
        const alias = normalizeSearch(branch.name).replace(/^vitacare\s*/, '');
        return containsSearchPhrase(q, alias);
      });
      if (matches.length === 1) {
        branchId = matches[0].id;
        q = normalizeSearch(q).replace(normalizeSearch(matches[0].name), ' ')
          .replace(normalizeSearch(matches[0].name).replace(/^vitacare\s*/, ''), ' ').trim();
      }
    }

    // 1. Thực thi đồng thời 3 luồng tìm kiếm song song
    const results = await Promise.allSettled([
      parseSearchIntent(originalQuery).entity === 'doctor' ? Promise.resolve([]) : this.searchPackages(q, branchId),
      this.searchDoctors(q, branchId),
      this.searchBranches(originalQuery, availableBranches),
    ]);
    const packages = results[0].status === 'fulfilled' ? results[0].value : [];
    const doctors = results[1].status === 'fulfilled' ? results[1].value : [];
    const branches = results[2].status === 'fulfilled' ? results[2].value : [];
    const partial = results.some(result => result.status === 'rejected');
    if (partial && packages.length + doctors.length + branches.length === 0) {
      throw new ServiceUnavailableException('Không thể tải kết quả tìm kiếm. Vui lòng thử lại.');
    }

    const finalResult: SemanticSearchResult = {
      query: originalQuery,
      branchId,
      partial,
      total: packages.length + doctors.length + branches.length,
      packages,
      doctors,
      branches,
    };

    // 2. Telemetry Bất đồng bộ (Fire-and-forget: Không làm chậm response của Client)
    setImmediate(() => {
      if (partial) return;
      this.recordTelemetryAsync(originalQuery, finalResult.total > 0).catch((err) => {
        this.logger.debug(`[SemanticSearch] Telemetry background log error: ${err?.message}`);
      });
    });

    return finalResult;
  }

  /**
   * 1. Tìm kiếm và phân tích ngữ nghĩa Gói khám với Cache & Threshold
   */
  private async searchPackages(q: string, branchId?: string) {
    try {
      const candidatePackages = await this.getCachedCandidatePackages(branchId);
      if (!candidatePackages || candidatePackages.length === 0) return [];

      const results = await this.embeddingService.searchByNaturalLanguage(q, candidatePackages, 6, { strictSemantic: true });

      // Eligibility and relevance thresholds are applied once by the retrieval engine.
      return results
        .map((r) => ({
          id: r.package.id,
          code: r.package.code,
          name: r.package.name,
          price: r.package.price,
          durationMin: r.package.durationMin,
          specialtyName: r.package.specialtyName,
          similarityScore: Math.round(r.score * 100) / 100,
          description: r.package.description,
          branchId: r.package.branchId,
          bookingMethodCode: r.package.bookingMethodCode,
          specialtyId: r.package.specialtyId,
        }));
    } catch (err: any) {
      this.logger.warn(`[SemanticSearch] searchPackages error: ${err?.message}`);
      throw err;
    }
  }

  /**
   * 2. Tìm kiếm Bác sĩ (Bảo vệ thông tin nhạy cảm: Không select phone/email)
   */
  private async searchDoctors(q: string, branchId?: string) {
    try {
      const intent = parseSearchIntent(q);
      if (!intent.text) return [];
      const matched = await this.prisma.doctor.findMany({
        where: {
          isActive: true,
          ...(branchId ? { user: { branchAssignments: { some: { branchId } } } } : {}),
        },
        select: {
          id: true,
          academicRank: true,
          experienceYears: true,
          avatarUrl: true,
          ratingAverage: true,
          consultationFee: true,
          user: { select: { fullName: true } }, // Chỉ lấy fullName, loại bỏ phoneNumber và email nhạy cảm
          specialties: { select: { specialty: { select: { name: true } } } },
        },
      });

      return matched.filter(doc => matchesSearchConstraints(intent, { price: Number(doc.consultationFee) })).map(doc => ({ doc, score: Math.max(
        searchTextScore(intent.text, doc.user?.fullName || ''),
        searchTextScore(intent.text, doc.academicRank || ''),
        ...doc.specialties.map(s => searchTextScore(intent.text, s.specialty.name)),
      ) })).filter(hit => hit.score > 0).sort((a, b) => b.score - a.score || a.doc.id.localeCompare(b.doc.id))
        .slice(0, 4).map(({ doc }) => ({
        id: doc.id,
        fullName: doc.user?.fullName || 'Bác sĩ',
        academicRank: doc.academicRank || 'Bác sĩ',
        specialties: doc.specialties.map((s) => s.specialty?.name).filter(Boolean) as string[],
        experienceYears: doc.experienceYears || 0,
        avatarUrl: doc.avatarUrl || null,
        ratingAverage: doc.ratingAverage,
      }));
    } catch (err: any) {
      this.logger.warn(`[SemanticSearch] searchDoctors error: ${err?.message}`);
      throw err;
    }
  }

  /**
   * 3. Tìm kiếm Cơ sở y tế
   */
  private async searchBranches(q: string, branches: SemanticSearchResult['branches']) {
    const intent = parseSearchIntent(q);
    if (!intent.text) return [];
    return branches.map(branch => ({ branch, score: Math.max(
      searchTextScore(intent.text, branch.name), searchTextScore(intent.text, branch.address),
    ) })).filter(hit => hit.score > 0).sort((a, b) => b.score - a.score).slice(0, 3).map(hit => hit.branch);
  }

  /**
   * Lấy danh sách gói khám ứng viên (Được đệm Cache Redis 5 phút để tránh quét DB liên tục)
   */
  private async getCachedCandidatePackages(branchId?: string): Promise<PackageForRetrieval[]> {
    const cacheKey = `rec:cache:search_candidates:v2:${branchId || 'all'}`;

    if (this.redis.isEnabled()) {
      try {
        const cached = await this.redis.get<PackageForRetrieval[]>(cacheKey);
        if (cached && Array.isArray(cached) && cached.length > 0) {
          return cached;
        }
      } catch { }
    }

    const pkgs = await this.prisma.servicePackage.findMany({
      where: {
        isActive: true,
        OR: [
          { branchBookingMethod: { ...(branchId ? { branchId } : {}), isEnabled: true, branch: { isActive: true }, bookingMethod: { isActive: true } } },
          { branchBookingMethods: { some: { branchBookingMethod: { ...(branchId ? { branchId } : {}), isEnabled: true, branch: { isActive: true }, bookingMethod: { isActive: true } } } } },
        ],
      },
      select: {
        id: true, code: true, name: true, price: true, durationMin: true, description: true,
        symptoms: true, specialtyId: true, targetGender: true, minAge: true, maxAge: true,
        specialty: { select: { id: true, name: true, symptoms: true, description: true } },
        branchBookingMethod: { select: { branchId: true, isEnabled: true, branch: { select: { isActive: true } }, bookingMethod: { select: { code: true, isActive: true } } } },
        branchBookingMethods: { select: { branchBookingMethod: { select: { branchId: true, isEnabled: true, branch: { select: { isActive: true } }, bookingMethod: { select: { code: true, isActive: true } } } } } },
      },
      orderBy: { price: 'asc' },
    });

    const mapped: PackageForRetrieval[] = pkgs.map((p) => {
      const methods = [p.branchBookingMethod, ...p.branchBookingMethods.map(link => link.branchBookingMethod)]
        .filter(method => method?.isEnabled && method.branch.isActive && method.bookingMethod.isActive);
      const method = methods.find(method => !branchId || method?.branchId === branchId);
      const combinedSymptoms = Array.from(
        new Set([...(p.symptoms || []), ...(p.specialty?.symptoms || [])]),
      );
      const fullDescription = [p.description, p.specialty?.description]
        .filter(Boolean)
        .join(' - ');
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        description: fullDescription,
        symptoms: combinedSymptoms,
        price: Number(p.price),
        durationMin: p.durationMin,
        specialtyId: p.specialtyId,
        specialtyName: p.specialty?.name || 'Đa khoa',
        targetGender: p.targetGender, minAge: p.minAge, maxAge: p.maxAge,
        branchId: method?.branchId, bookingMethodCode: method?.bookingMethod.code,
      };
    });

    if (this.redis.isEnabled() && mapped.length > 0) {
      await this.redis.set(cacheKey, mapped, this.PACKAGES_CACHE_TTL_SECONDS).catch(() => { });
    }

    return mapped;
  }

  /**
   * Ghi nhận telemetry thống kê từ khóa bất đồng bộ (Non-blocking Background Task)
   */
  private async recordTelemetryAsync(query: string, hasResults: boolean): Promise<void> {
    if (!query || query.trim().length < 2) return;
    const normalizedQ = query.trim().toLowerCase();
    const dateKey = vietnamDateKey(new Date());

    // 1. Ghi nhận vào Redis Ranking ZSET (theo ngày và toàn thời gian)
    if (this.redis.isEnabled()) {
      try {
        const client = this.redis.getClient();
        if (client) {
          const zsetKey = hasResults ? 'rec:global:search_queries' : 'rec:global:unmatched_queries';
          const dailyZsetKey = `${zsetKey}:${dateKey}`;
          const pipeline = client.pipeline();
          pipeline.zincrby(dailyZsetKey, 1, normalizedQ);
          pipeline.expire(dailyZsetKey, 172800); // 48 giờ
          pipeline.zincrby(zsetKey, 1, normalizedQ);
          await pipeline.exec();
        }
      } catch (err: any) {
        this.logger.debug(`[SemanticSearch] Redis telemetry error: ${err?.message}`);
      }
    }

  }
}
