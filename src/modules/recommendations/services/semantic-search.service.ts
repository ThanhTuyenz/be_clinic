import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import { RedisService } from '../../../infrastructure/redis/redis.service.js';
import { EmbeddingService, PackageForRetrieval } from '../../../infrastructure/embedding/embedding.service.js';

export interface SemanticSearchResult {
  query: string;
  total: number;
  packages: Array<{
    id: string;
    code: string;
    name: string;
    price: number;
    durationMin: number;
    specialtyName: string;
    similarityScore: number;
    description: string;
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
  ) { }

  /**
   * Tìm kiếm thông minh đa thực thể (Gói khám, Bác sĩ, Cơ sở) bằng Vector Embeddings & Heuristic Matcher
   */
  async semanticSearchPackages(query: string, branchId?: string): Promise<SemanticSearchResult> {
    if (!query || !query.trim()) {
      return { query: '', total: 0, packages: [], doctors: [], branches: [] };
    }
    const q = query.trim();

    // 1. Thực thi đồng thời 3 luồng tìm kiếm song song
    const [packages, doctors, branches] = await Promise.all([
      this.searchPackages(q, branchId),
      this.searchDoctors(q),
      this.searchBranches(q),
    ]);

    const finalResult: SemanticSearchResult = {
      query: q,
      total: packages.length + doctors.length + branches.length,
      packages,
      doctors,
      branches,
    };

    // 2. Telemetry Bất đồng bộ (Fire-and-forget: Không làm chậm response của Client)
    setImmediate(() => {
      this.recordTelemetryAsync(q, packages.length > 0 || doctors.length > 0).catch((err) => {
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

      const results = await this.embeddingService.searchByNaturalLanguage(q, candidatePackages, 6);

      // Lọc theo ngưỡng điểm tối thiểu để loại bỏ kết quả nhiễu (Thresholding)
      return results
        .filter((r) => r.score >= 1.0) // Điểm kết hợp text/symptom/vector >= 1.0
        .map((r) => ({
          id: r.package.id,
          code: r.package.code,
          name: r.package.name,
          price: r.package.price,
          durationMin: r.package.durationMin,
          specialtyName: r.package.specialtyName,
          similarityScore: Math.round(r.score * 100) / 100,
          description: r.package.description,
        }));
    } catch (err: any) {
      this.logger.warn(`[SemanticSearch] searchPackages error: ${err?.message}`);
      return [];
    }
  }

  /**
   * 2. Tìm kiếm Bác sĩ (Bảo vệ thông tin nhạy cảm: Không select phone/email)
   */
  private async searchDoctors(q: string) {
    try {
      const matched = await this.prisma.doctor.findMany({
        where: {
          isActive: true,
          OR: [
            { user: { fullName: { contains: q, mode: 'insensitive' } } },
            { academicRank: { contains: q, mode: 'insensitive' } },
            { specialties: { some: { specialty: { name: { contains: q, mode: 'insensitive' } } } } },
          ],
        },
        take: 4,
        select: {
          id: true,
          academicRank: true,
          experienceYears: true,
          avatarUrl: true,
          ratingAverage: true,
          user: { select: { fullName: true } }, // Chỉ lấy fullName, loại bỏ phoneNumber và email nhạy cảm
          specialties: { select: { specialty: { select: { name: true } } } },
        },
      });

      return matched.map((doc) => ({
        id: doc.id,
        fullName: doc.user?.fullName || 'Bác sĩ',
        academicRank: doc.academicRank || 'Bác sĩ',
        specialties: doc.specialties.map((s) => s.specialty?.name).filter(Boolean) as string[],
        experienceYears: doc.experienceYears || 0,
        avatarUrl: doc.avatarUrl || null,
        ratingAverage: doc.ratingAverage || 5.0,
      }));
    } catch (err: any) {
      this.logger.warn(`[SemanticSearch] searchDoctors error: ${err?.message}`);
      return [];
    }
  }

  /**
   * 3. Tìm kiếm Cơ sở y tế
   */
  private async searchBranches(q: string) {
    try {
      return await this.prisma.branch.findMany({
        where: {
          isActive: true,
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { address: { contains: q, mode: 'insensitive' } },
          ],
        },
        take: 3,
        select: { id: true, code: true, name: true, address: true, phoneNumber: true },
      });
    } catch (err: any) {
      this.logger.warn(`[SemanticSearch] searchBranches error: ${err?.message}`);
      return [];
    }
  }

  /**
   * Lấy danh sách gói khám ứng viên (Được đệm Cache Redis 5 phút để tránh quét DB liên tục)
   */
  private async getCachedCandidatePackages(branchId?: string): Promise<PackageForRetrieval[]> {
    const cacheKey = `rec:cache:search_candidates:${branchId || 'all'}`;

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
        ...(branchId ? { branchBookingMethod: { branchId, isEnabled: true } } : {}),
      },
      include: {
        specialty: { select: { id: true, name: true, symptoms: true, description: true } },
      },
      orderBy: { price: 'asc' },
    });

    const mapped: PackageForRetrieval[] = pkgs.map((p) => {
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
    const dateKey = new Date().toISOString().slice(0, 10);

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

    // 2. Ghi nhận vào PostgreSQL SearchLog (Upsert với Composite Key theo dateKey)
    try {
      await this.prisma.searchLog.upsert({
        where: {
          keyword_dateKey_hasResults: {
            keyword: normalizedQ,
            dateKey,
            hasResults,
          },
        },
        update: { count: { increment: 1 } },
        create: {
          keyword: normalizedQ,
          dateKey,
          count: 1,
          hasResults,
        },
      });
    } catch (err: any) {
      this.logger.debug(`[SemanticSearch] DB search log error: ${err?.message}`);
    }
  }
}
