import { PACKAGE_DEPLOYMENT_SELECT, getPackageDeployments, packageDeploymentWhere } from '../../bookings/helpers/package-deployment.helper.js';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { containsSearchPhrase, matchesSearchConstraints, matchesSearchExclusions, normalizeSearch, parseSearchIntent, replaceSearchText, searchTextScore } from '../../../common/utils/search-query.js';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import { RedisService } from '../../../infrastructure/redis/redis.service.js';
import { mapPackageForRetrieval, PackageForRetrieval } from '../../../infrastructure/embedding/embedding.service.js';
import { SearchRankingService } from './search-ranking.service.js';
import { RecommendationService } from '../../recommendations/recommendation.service.js';
import { TrackingActionType } from '../../recommendations/recommendation.dto.js';

export interface SemanticSearchResult {
  query: string;
  behaviorRecorded?: boolean;
  branchId?: number;
  total: number;
  partial?: boolean;
  packages: Array<{
    id: number;
    code: string;
    name: string;
    price: number;
    durationMin: number;
    specialtyName: string;
    similarityScore: number;
    description: string;
    branchId?: number;
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
  }>;
  branches: Array<{
    id: number;
    code: string;
    name: string;
    address: string;
    phoneNumber: string | null;
  }>;
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);
  private readonly PACKAGES_CACHE_TTL_SECONDS = 300; // 5 phút cache danh sách gói khám ứng viên

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly ranking: SearchRankingService,
    private readonly recommendations: RecommendationService,
  ) { }

  /**
   * Tìm kiếm thông minh đa thực thể (Gói khám, Bác sĩ, Cơ sở) bằng Vector Embeddings & Heuristic Matcher
   */
  async find(query: string, branchId?: number, context: { sessionId?: string; accountId?: string } = {}): Promise<SemanticSearchResult> {
    const result = await this.runSearch(query, branchId);
    result.behaviorRecorded = false;
    if (!result.partial && query.trim().length >= 2 && (context.sessionId || context.accountId)) {
      // Reuse the actual search ranking for behavior recommendations.
      const behavior = await this.recommendations.trackUserBehavior({
        sessionId: context.sessionId, actionType: TrackingActionType.SEARCH, searchQuery: query.trim(),
        searchPackageIds: result.packages.map(pkg => pkg.id),
      }, context.accountId).catch(() => {
        this.logger.debug('Không thể cập nhật hành vi tìm kiếm');
        return undefined;
      });
      result.behaviorRecorded = behavior?.recorded === true;
    }
    return result;
  }

  private async runSearch(query: string, branchId?: number): Promise<SemanticSearchResult> {
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
        q = replaceSearchText(q, normalizeSearch(matches[0].name), () => ' ');
        q = replaceSearchText(q, normalizeSearch(matches[0].name).replace(/^vitacare\s*/, ''), () => ' ').trim();
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

    return {
      query: originalQuery,
      branchId,
      partial,
      total: packages.length + doctors.length + branches.length,
      packages,
      doctors,
      branches,
    };

  }

  /**
   * 1. Tìm kiếm gói khám bằng từ khóa và ngữ nghĩa, hợp nhất bằng RRF.
   */
  private async searchPackages(q: string, branchId?: number) {
    try {
      const candidatePackages = await this.getCachedCandidatePackages(branchId);
      if (!candidatePackages || candidatePackages.length === 0) return [];

      const results = await this.ranking.rank(q, candidatePackages, 6);

      // Constraints and ranking are applied once by the retrieval engine.
      return results
        .map((r) => ({
          id: r.package.id,
          code: r.package.code,
          name: r.package.name,
          price: r.package.price,
          durationMin: r.package.durationMin,
          specialtyName: r.package.specialtyName,
          similarityScore: Number(r.score.toFixed(6)), // RRF score for text queries; not cosine similarity or confidence.
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
  private async searchDoctors(q: string, branchId?: number) {
    try {
      const intent = parseSearchIntent(q);
      if (!intent.text) return [];
      const matched = await this.prisma.doctor.findMany({
        where: {
          isActive: true,
          ...(branchId ? { user: { branchId } } : {}),
        },
        select: {
          id: true,
          academicRank: true,
          experienceYears: true,
          avatarUrl: true,
          consultationFee: true,
          user: { select: { fullName: true } }, // Chỉ lấy fullName, loại bỏ phoneNumber và email nhạy cảm
          specialties: { select: { specialty: { select: { name: true } } } },
        },
      });

      return matched.filter(doc => matchesSearchConstraints(intent, { price: Number(doc.consultationFee) })
        && matchesSearchExclusions(intent, [doc.user?.fullName, doc.academicRank, ...doc.specialties.map(s => s.specialty.name)]))
        .map(doc => ({ doc, score: Math.max(
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
    return branches.filter(branch => matchesSearchExclusions(intent, [branch.name, branch.address])).map(branch => ({ branch, score: Math.max(
      searchTextScore(intent.text, branch.name), searchTextScore(intent.text, branch.address),
    ) })).filter(hit => hit.score > 0).sort((a, b) => b.score - a.score).slice(0, 3).map(hit => hit.branch);
  }

  /**
   * Lấy danh sách gói khám ứng viên (Được đệm Cache Redis 5 phút để tránh quét DB liên tục)
   */
  private async getCachedCandidatePackages(branchId?: number): Promise<PackageForRetrieval[]> {
    const cacheKey = `search:cache:candidates:v2:${branchId || 'all'}`;

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
        ...await packageDeploymentWhere(this.prisma, branchId, undefined),
      },
      select: {
        id: true, code: true, name: true, price: true, durationMin: true, description: true,
        symptoms: true, specialtyId: true, targetGender: true, minAge: true, maxAge: true, isFollowUp: true,
        specialty: { select: { id: true, name: true, symptoms: true, description: true } },

        ...PACKAGE_DEPLOYMENT_SELECT,
      },
      orderBy: { price: 'asc' },
    });

    const mapped: PackageForRetrieval[] = pkgs.map((p) => {
      const methods = getPackageDeployments(p)
        .filter(method => method?.isEnabled && method.branch.isActive && method.bookingMethod.isActive);
      const method = methods.find(method => !branchId || method?.branchId === branchId);
      return {
        ...mapPackageForRetrieval(p),
        branchId: method?.branchId, bookingMethodCode: method?.bookingMethod.code,
      };
    });

    if (this.redis.isEnabled() && mapped.length > 0) {
      await this.redis.set(cacheKey, mapped, this.PACKAGES_CACHE_TTL_SECONDS).catch(() => { });
    }

    return mapped;
  }
}
