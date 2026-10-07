import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import {
  ProfileRecommendationResponseDto,
  RecommendedPackageItemDto,
  TrackBehaviorDto,
  HomeRecommendationQueryDto,
  HomeRecommendationResponseDto,
} from './recommendation.dto.js';
import { CandidatePoolItem, TELEMETRY_CONFIG } from './constants/recommendation.constants.js';
import { BehaviorTelemetryService } from './services/behavior-telemetry.service.js';
import { CandidateRetrievalService } from './services/candidate-retrieval.service.js';
import { AiRankingService } from './services/ai-ranking.service.js';
import { SemanticSearchService } from './services/semantic-search.service.js';

@Injectable()
export class RecommendationService {
  private readonly logger = new Logger(RecommendationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly behaviorTelemetryService: BehaviorTelemetryService,
    private readonly candidateRetrievalService: CandidateRetrievalService,
    private readonly aiRankingService: AiRankingService,
    private readonly semanticSearchService: SemanticSearchService,
  ) { }


  async getHomeRecommendations(
    query: HomeRecommendationQueryDto,
    userId?: string,
  ): Promise<HomeRecommendationResponseDto> {
    const t0 = Date.now();
    const homeCacheKey = this.buildHomeCacheKey({
      userId,
      sessionId: query.sessionId,
      profileId: query.profileId,
      branchId: query.branchId,
    });

    const cached = await this.getCachedHomeRecommendations(homeCacheKey);
    if (cached) return cached;

    const allActivePackages = await this.candidateRetrievalService.loadActivePackages(query.branchId);

    const [profileTower, behaviorTower] = await Promise.all([
      this.candidateRetrievalService.getProfileCandidates(query.profileId, query.branchId, allActivePackages),
      this.candidateRetrievalService.getBehaviorCandidates(userId, query.sessionId, query.branchId, allActivePackages),
    ]);

    const candidatePool = this.candidateRetrievalService.buildHomeCandidatePool(
      profileTower,
      behaviorTower,
      allActivePackages,
    );

    const { packages, source } = await this.rankHomeCandidates(candidatePool, profileTower, behaviorTower);

    return this.cacheAndBuildHomeResponse(
      query,
      profileTower.profile?.fullName,
      packages,
      source,
      homeCacheKey,
      t0,
    );
  }

  private async getCachedHomeRecommendations(cacheKey: string): Promise<HomeRecommendationResponseDto | null> {
    if (!this.redis.isEnabled()) return null;
    try {
      const cached = await this.redis.get<HomeRecommendationResponseDto>(cacheKey);
      if (cached && Array.isArray(cached.packages) && cached.packages.length > 0) {
        return cached;
      }
    } catch (err: any) {
      this.logger.debug(`[HomeRec] Failed to read cache: ${err?.message}`);
    }
    return null;
  }

  private async rankHomeCandidates(
    candidatePool: CandidatePoolItem[],
    profileTower: any,
    behaviorTower: any,
  ): Promise<{
    packages: RecommendedPackageItemDto[];
    source: 'HYBRID' | 'AI_PROFILE' | 'BEHAVIOR' | 'FALLBACK';
  }> {
    const hasBehaviorIntent = behaviorTower.candidates.length > 0;
    const hasProfileIntent = !!profileTower.profile;

    let detectedSource: 'HYBRID' | 'AI_PROFILE' | 'BEHAVIOR' | 'FALLBACK' = 'FALLBACK';
    if (hasProfileIntent && hasBehaviorIntent) detectedSource = 'HYBRID';
    else if (hasProfileIntent) detectedSource = 'AI_PROFILE';
    else if (hasBehaviorIntent) detectedSource = 'BEHAVIOR';

    // TỐI ƯU TẦNG CACHE HỒ SƠ 7 NGÀY:
    // Nếu chỉ xem theo Hồ sơ (không có hành vi lướt web mới), kiểm tra xem cache 7 ngày của hồ sơ đã có kết quả AI chưa
    if (hasProfileIntent && !hasBehaviorIntent && this.redis.isEnabled()) {
      try {
        const cachedProfileRec = await this.redis.get<ProfileRecommendationResponseDto>(
          this.candidateRetrievalService.buildCacheKey(profileTower.profile.id),
        );
        if (cachedProfileRec && Array.isArray(cachedProfileRec.packages) && cachedProfileRec.packages.length > 0) {
          return {
            packages: cachedProfileRec.packages.slice(0, TELEMETRY_CONFIG.HOME_FINAL_PACKAGES_LIMIT),
            source: 'AI_PROFILE',
          };
        }
      } catch (err: any) {
        this.logger.debug(`[HomeRec] Failed to read profile AI cache: ${err?.message}`);
      }
    }

    let reRankedPackages: RecommendedPackageItemDto[] = [];

    // Chỉ gọi Gemini khi CÓ BỆNH ÁN hoặc CÓ HÀNH VI QUAN TÂM
    if (this.aiRankingService.isAiAvailable() && candidatePool.length > 0 && (hasProfileIntent || hasBehaviorIntent)) {
      try {
        reRankedPackages = await this.aiRankingService.evaluateHybridWithGemini({
          profile: profileTower.profile
            ? {
              fullName: profileTower.profile.fullName,
              age: profileTower.age,
              gender: profileTower.gender,
              bmi: profileTower.bmi,
              medicalHistory: profileTower.medicalHistory,
              allergies: profileTower.allergies,
            }
            : null,
          behaviorContext: {
            topSpecialties: behaviorTower.topSpecialties.map((s: any) => `${s.specialtyName} (${s.score} điểm)`).join(', ') || 'Chưa ghi nhận',
            lastSearchQuery: behaviorTower.lastSearchQuery || 'Không có',
            dropOffPkgName: candidatePool.find((c) => c.origin === 'BEHAVIOR' && c.behaviorSourceType === 'DROP_OFF')?.pkg.name,
          },
          candidates: candidatePool.map((c) => ({
            id: c.pkg.id,
            name: c.pkg.name,
            code: c.pkg.code,
            slug: c.pkg.slug,
            description: c.pkg.description || '',
            price: Number(c.pkg.price),
            specialtyName: c.pkg.specialty?.name || 'Đa khoa',
            specialtyId: c.pkg.specialtyId,
            durationMin: c.pkg.durationMin,
            origin: c.origin,
            behaviorSourceType: c.behaviorSourceType,
          })),
        });

        // Nếu Gemini phân tích thành công cho nhánh Hồ sơ thuần (AI_PROFILE), lưu luôn vào Cache Hồ sơ 7 ngày để tái sử dụng
        if (reRankedPackages.length > 0 && hasProfileIntent && !hasBehaviorIntent && this.redis.isEnabled()) {
          const profileRecDto: ProfileRecommendationResponseDto = {
            profileId: profileTower.profile.id,
            profileName: profileTower.profile.fullName,
            updatedAt: new Date().toISOString(),
            source: 'AI_GEMINI',
            packages: reRankedPackages,
          };
          this.redis.set(
            this.candidateRetrievalService.buildCacheKey(profileTower.profile.id),
            profileRecDto,
            TELEMETRY_CONFIG.PROFILE_CACHE_TTL_SECONDS,
          ).catch(() => { });
        }
      } catch (err: any) {
        this.logger.warn(`Gemini Re-ranking failed (${err?.message}) -> Fallback heuristics`);
      }
    }

    // Fallback Heuristics nếu AI không trả về kết quả
    if (reRankedPackages.length === 0) {
      reRankedPackages = this.aiRankingService.evaluateHybridWithHeuristics(
        candidatePool,
        profileTower.profile,
        profileTower.medicalHistory,
      );
    }

    return {
      packages: reRankedPackages.slice(0, TELEMETRY_CONFIG.HOME_FINAL_PACKAGES_LIMIT),
      source: detectedSource,
    };
  }

  private async cacheAndBuildHomeResponse(
    query: HomeRecommendationQueryDto,
    profileName: string | undefined,
    packages: RecommendedPackageItemDto[],
    source: 'HYBRID' | 'AI_PROFILE' | 'BEHAVIOR' | 'FALLBACK',
    homeCacheKey: string,
    startTime: number,
  ): Promise<HomeRecommendationResponseDto> {
    const finalResponse: HomeRecommendationResponseDto = {
      profileId: query.profileId,
      profileName,
      updatedAt: new Date().toISOString(),
      source,
      packages,
    };

    if (this.redis.isEnabled() && packages.length > 0) {
      try {
        const ttl =
          source === 'FALLBACK'
            ? TELEMETRY_CONFIG.HOME_CACHE_TTL_FALLBACK
            : TELEMETRY_CONFIG.HOME_CACHE_TTL_PERSONALIZED;
        await this.redis.set(homeCacheKey, finalResponse, ttl);
      } catch (err: any) {
        this.logger.debug(`[HomeRec] Failed to save cache: ${err?.message}`);
      }
    }

    this.logger.log(
      `🏁 [HYBRID PIPELINE] Source: ${source} | ${packages.length} pkgs | Time: ${Date.now() - startTime}ms`,
    );

    return finalResponse;
  }




  triggerAsyncRecommendation(profileId: string): void {
    void this.enqueueRecommendationTask(profileId);
  }

  private async enqueueRecommendationTask(profileId: string): Promise<void> {
    try {
      await this.prisma.outboxEvent.create({
        data: {
          aggregateType: 'PatientProfile',
          aggregateId: profileId,
          eventType: 'recommendation.profile.analyze',
          payload: { profileId },
        },
      });
    } catch {
      setImmediate(() => {
        this.analyzeAndCacheRecommendations(profileId).catch(() => { });
      });
    }
  }

  async invalidateCache(profileId: string): Promise<void> {
    try {
      if (this.redis.isEnabled()) {
        const key = this.candidateRetrievalService.buildCacheKey(profileId);
        await Promise.allSettled([
          this.redis.delete(key),
          this.redis.delete(`${key}:all`),
          this.redis.deletePattern(`rec:home:prof:${profileId}:*`),
          this.redis.deletePattern(`rec:home:u:*:${profileId}:*`),
        ]);
      }
    } catch { }
  }

  async analyzeAndCacheRecommendations(
    profileId: string,
    branchId?: string,
  ): Promise<ProfileRecommendationResponseDto> {
    const profileTower = await this.candidateRetrievalService.getProfileCandidates(profileId, branchId, undefined, true);
    if (!profileTower.profile) {
      return {
        profileId,
        updatedAt: new Date().toISOString(),
        source: 'RULE_FALLBACK',
        packages: [],
      };
    }

    let aiList: RecommendedPackageItemDto[] = [];
    let source: 'AI_GEMINI' | 'RULE_FALLBACK' = 'RULE_FALLBACK';

    const candidateObjects = profileTower.candidates.map((c) => ({
      id: c.pkg.id,
      name: c.pkg.name,
      code: c.pkg.code,
      slug: c.pkg.slug,
      description: c.pkg.description || '',
      price: Number(c.pkg.price),
      specialtyName: c.pkg.specialty?.name || 'Đa khoa',
      specialtyId: c.pkg.specialtyId,
      durationMin: c.pkg.durationMin,
      origin: 'PROFILE',
    }));

    if (this.aiRankingService.isAiAvailable() && candidateObjects.length > 0) {
      try {
        aiList = await this.aiRankingService.evaluateHybridWithGemini({
          profile: {
            fullName: profileTower.profile.fullName,
            age: profileTower.age,
            gender: profileTower.gender,
            bmi: profileTower.bmi,
            medicalHistory: profileTower.medicalHistory,
            allergies: profileTower.allergies,
          },
          behaviorContext: { topSpecialties: 'Không có', lastSearchQuery: 'Không có' },
          candidates: candidateObjects,
        });
        if (aiList.length > 0) source = 'AI_GEMINI';
      } catch { }
    }

    if (aiList.length === 0) {
      aiList = this.aiRankingService.evaluateHybridWithHeuristics(
        profileTower.candidates.map((c) => ({ pkg: c.pkg, origin: 'PROFILE', isFollowUp: c.isFollowUp })),
        profileTower.profile,
        profileTower.medicalHistory,
      );
    }

    const result: ProfileRecommendationResponseDto = {
      profileId,
      profileName: profileTower.profile.fullName,
      updatedAt: new Date().toISOString(),
      source,
      packages: aiList,
    };

    if (source === 'AI_GEMINI' && this.redis.isEnabled()) {
      try {
        await this.redis.set(
          this.candidateRetrievalService.buildCacheKey(profileId),
          result,
          TELEMETRY_CONFIG.PROFILE_CACHE_TTL_SECONDS,
        );
      } catch { }
    }

    return result;
  }

  // ===================================================================================
  // CÁC HÀM DELEGATE (ỦY QUYỀN SANG DỊCH VỤ CON)
  // ===================================================================================

  async trackUserBehavior(dto: TrackBehaviorDto, userId?: string): Promise<{ success: boolean }> {
    return this.behaviorTelemetryService.trackUserBehavior(dto, userId);
  }

  async semanticSearchPackages(query: string, branchId?: string) {
    return this.semanticSearchService.semanticSearchPackages(query, branchId);
  }

  async suggestSymptomsForPackage(name: string, specialtyName?: string): Promise<{ symptoms: string[] }> {
    return this.aiRankingService.suggestSymptomsForPackage(name, specialtyName);
  }

  async getBehaviorTelemetryContext(userId?: string, sessionId?: string) {
    return this.behaviorTelemetryService.getBehaviorTelemetryContext(userId, sessionId);
  }

  async getProfileCandidates(profileId?: string, branchId?: string, preloadedPackages?: any[], skipCache = false) {
    return this.candidateRetrievalService.getProfileCandidates(profileId, branchId, preloadedPackages, skipCache);
  }

  async getBehaviorCandidates(userId?: string, sessionId?: string, branchId?: string, preloadedPackages?: any[]) {
    return this.candidateRetrievalService.getBehaviorCandidates(userId, sessionId, branchId, preloadedPackages);
  }

  private buildHomeCacheKey(params: { userId?: string; sessionId?: string; profileId?: string; branchId?: string }): string {
    const b = params.branchId || 'all';
    if (params.userId) {
      const p = params.profileId || 'noprofile';
      return `rec:home:u:${params.userId}:${p}:${b}`;
    }
    if (params.profileId) {
      return `rec:home:prof:${params.profileId}:${b}`;
    }
    if (params.sessionId) {
      return `rec:home:sess:${params.sessionId}:${b}`;
    }
    return `rec:home:generic:${b}`;
  }
}
