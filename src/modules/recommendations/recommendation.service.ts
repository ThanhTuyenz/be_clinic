import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
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
    userRole?: string,
  ): Promise<HomeRecommendationResponseDto> {
    if (query.profileId) {
      await this.assertProfileAccess(query.profileId, userId, userRole);
    }
    const t0 = Date.now();
    const homeCacheKey = this.buildHomeCacheKey({
      userId,
      sessionId: query.sessionId,
      profileId: query.profileId,
    });

    const cached = await this.getCachedHomeRecommendations(homeCacheKey);
    if (cached) {
      this.logger.log(
        `🟢 [REC-HOME: CACHE HIT (0ms)] Source: ${cached.source} | ${cached.packages.length} pkgs | CacheKey: ${homeCacheKey}`,
      );
      return {
        ...cached,
        isCached: true,
        fromCache: true,
        dataOrigin: 'CACHE',
      };
    }

    const allActivePackages = await this.candidateRetrievalService.loadActivePackages();

    const [profileTower, behaviorTower] = await Promise.all([
      this.candidateRetrievalService.getProfileCandidates(query.profileId, allActivePackages),
      this.candidateRetrievalService.getBehaviorCandidates(userId, query.sessionId, allActivePackages),
    ]);

    const candidatePool = this.candidateRetrievalService.buildHomeCandidatePool(
      profileTower,
      behaviorTower,
      allActivePackages,
    );

    const { packages, source, event, triggerEvent, triggerReason, isCached, fromCache, dataOrigin } = await this.rankHomeCandidates(candidatePool, profileTower, behaviorTower);

    return this.cacheAndBuildHomeResponse(
      query,
      profileTower.profile?.fullName,
      packages,
      source,
      homeCacheKey,
      t0,
      { event, triggerEvent, triggerReason, isCached, fromCache, dataOrigin },
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
    event: string;
    triggerEvent: string;
    triggerReason: string;
    isCached?: boolean;
    fromCache?: boolean;
    dataOrigin?: 'CACHE' | 'NEW';
  }> {
    const hasBehaviorIntent = behaviorTower.candidates.length > 0;
    const hasProfileIntent = !!profileTower.profile;

    let detectedSource: 'HYBRID' | 'AI_PROFILE' | 'BEHAVIOR' | 'FALLBACK' = 'FALLBACK';
    let event = 'COLD_START';
    let triggerEvent = 'DEFAULT_PACKAGES';
    let triggerReason = 'Khởi động gợi ý mặc định hệ thống (Khách vãng lai)';

    if (hasProfileIntent && hasBehaviorIntent) {
      detectedSource = 'HYBRID';
      event = 'CREATE_PROFILE + BEHAVIOR_SCORE';
      triggerEvent = 'CREATE_PROFILE + BEHAVIOR_SCORE';
      triggerReason = `Kết hợp hồ sơ và ${behaviorTower.candidates.length} gói quan tâm từ hành vi`;
    } else if (hasProfileIntent) {
      detectedSource = 'AI_PROFILE';
      event = 'CREATE_PROFILE';
      triggerEvent = 'CREATE_PROFILE';
      triggerReason = `Kích hoạt từ hồ sơ bệnh nhân (${profileTower.age} tuổi)`;
    } else if (hasBehaviorIntent) {
      detectedSource = 'BEHAVIOR';
      if (behaviorTower.dropOffPkgId) {
        event = 'DROP_OFF';
        triggerEvent = 'DROP_OFF';
        triggerReason = `Kích hoạt từ sự kiện Bỏ dở quy trình đặt khám gói ${behaviorTower.dropOffPkgName || behaviorTower.dropOffPkgId}`;
      } else if (behaviorTower.lastSearchQuery) {
        event = 'SEARCH_INTENT';
        triggerEvent = 'SEARCH_INTENT';
        triggerReason = `Kích hoạt từ Tìm kiếm triệu chứng/nhu cầu: "${behaviorTower.lastSearchQuery}"`;
      } else {
        event = 'BEHAVIOR_SCORE';
        triggerEvent = 'BEHAVIOR_SCORE';
        triggerReason = `Kích hoạt từ Điểm số tương tác (${behaviorTower.topSpecialties.map((s: any) => `${s.specialtyName}: ${s.score}đ`).join(', ')})`;
      }
    }

    this.logger.log(
      `🔍 [REC-HOME: PIPELINE START]\n` +
      `  👤 Nhánh Hồ sơ (Profile Tower): ${hasProfileIntent ? `CÓ (${profileTower.age} tuổi, ${profileTower.gender}) -> ${profileTower.candidates.length} ứng viên` : 'KHÔNG (Khách vãng lai / Chưa chọn hồ sơ)'}\n` +
      `  🎯 Nhánh Hành vi (Behavior Tower): ${hasBehaviorIntent ? `CÓ (Chuyên khoa: [${behaviorTower.topSpecialties.map((s: any) => `${s.specialtyName}:${s.score}đ`).join(', ')}], Tìm kiếm: "${behaviorTower.lastSearchQuery || 'không'}", Bỏ dở: "${behaviorTower.dropOffPkgId || 'không'}") -> ${behaviorTower.candidates.length} ứng viên` : 'KHÔNG (Chưa có điểm hành vi)'}\n` +
      `  ⚡ Sự kiện kích hoạt (Trigger Event): [${event}] ${triggerReason}\n` +
      `  📦 Tổng ứng viên (Candidate Pool): ${candidatePool.length} gói | Mô hình dự kiến: ${detectedSource}`,
    );

    // TỐI ƯU TẦNG CACHE HỒ SƠ 7 NGÀY:
    // Nếu chỉ xem theo Hồ sơ (không có hành vi lướt web mới), kiểm tra xem cache 7 ngày của hồ sơ đã có kết quả AI chưa
    if (hasProfileIntent && !hasBehaviorIntent && this.redis.isEnabled()) {
      try {
        const cachedProfileRec = await this.redis.get<ProfileRecommendationResponseDto>(
          this.candidateRetrievalService.buildCacheKey(profileTower.profile.id),
        );
        if (cachedProfileRec && Array.isArray(cachedProfileRec.packages) && cachedProfileRec.packages.length > 0) {
          this.logger.log(
            `⚡ [REC-HOME: FAST-PATH PROFILE CACHE HIT] Tái sử dụng kết quả AI Hồ sơ 7 ngày (${cachedProfileRec.packages.length} gói) (0ms LLM)`,
          );
          return {
            packages: cachedProfileRec.packages.slice(0, TELEMETRY_CONFIG.HOME_FINAL_PACKAGES_LIMIT),
            source: 'AI_PROFILE',
            event: cachedProfileRec.event || 'CREATE_PROFILE',
            triggerEvent: cachedProfileRec.triggerEvent || 'CREATE_PROFILE',
            triggerReason: cachedProfileRec.triggerReason || 'Tái sử dụng phân tích Hồ sơ từ Cache',
            isCached: true,
            fromCache: true,
            dataOrigin: 'CACHE',
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
        this.logger.log(`🤖 [REC-HOME: CALLING GEMINI LLM] Đang gửi ${candidatePool.length} gói ứng viên lên Gemini để re-ranking (Chế độ: ${detectedSource})...`);
        reRankedPackages = await this.aiRankingService.evaluateHybridWithGemini({
          profile: profileTower.profile
            ? {
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

        if (reRankedPackages.length > 0) {
          this.logger.log(
            `✅ [REC-HOME: GEMINI LLM THÀNH CÔNG] Đã re-rank và chọn ra ${reRankedPackages.length} gói khám tối ưu nhất từ Gemini! (Nguồn: ${detectedSource})`,
          );
        }

        // Nếu Gemini phân tích thành công cho nhánh Hồ sơ thuần (AI_PROFILE), lưu luôn vào Cache Hồ sơ 7 ngày để tái sử dụng
        if (reRankedPackages.length > 0 && hasProfileIntent && !hasBehaviorIntent && this.redis.isEnabled()) {
          const profileRecDto: ProfileRecommendationResponseDto = {
            profileId: profileTower.profile.id,
            profileName: profileTower.profile.fullName,
            updatedAt: new Date().toISOString(),
            source: 'AI_GEMINI',
            event,
            triggerEvent,
            triggerReason,
            packages: reRankedPackages,
          };
          this.redis.set(
            this.candidateRetrievalService.buildCacheKey(profileTower.profile.id),
            profileRecDto,
            TELEMETRY_CONFIG.PROFILE_CACHE_TTL_SECONDS,
          ).catch(() => { });
        }
      } catch (err: any) {
        this.logger.warn(`⚠️ [REC-HOME: GEMINI LLM THẤT BẠI] (${err?.message}) -> Chuyển sang Heuristics lâm sàng`);
      }
    }

    // Fallback Heuristics nếu AI không trả về kết quả
    if (reRankedPackages.length === 0) {
      this.logger.log(`🛡️ [REC-HOME: CHẠY HEURISTICS FALLBACK] Xếp hạng theo bộ luật chuyên môn lâm sàng (Nguồn: ${detectedSource})`);
      reRankedPackages = this.aiRankingService.evaluateHybridWithHeuristics(
        candidatePool,
        profileTower.profile,
        profileTower.medicalHistory,
      );
    }

    return {
      packages: reRankedPackages.slice(0, TELEMETRY_CONFIG.HOME_FINAL_PACKAGES_LIMIT),
      source: detectedSource,
      event,
      triggerEvent,
      triggerReason,
    };
  }

  private async cacheAndBuildHomeResponse(
    query: HomeRecommendationQueryDto,
    profileName: string | undefined,
    packages: RecommendedPackageItemDto[],
    source: 'HYBRID' | 'AI_PROFILE' | 'BEHAVIOR' | 'FALLBACK',
    homeCacheKey: string,
    startTime: number,
    meta?: {
      event?: string;
      triggerEvent?: string;
      triggerReason?: string;
      isCached?: boolean;
      fromCache?: boolean;
      dataOrigin?: 'CACHE' | 'NEW';
    },
  ): Promise<HomeRecommendationResponseDto> {
    const finalResponse: HomeRecommendationResponseDto = {
      profileId: query.profileId,
      profileName,
      updatedAt: new Date().toISOString(),
      source,
      event: meta?.event || 'CREATE_PROFILE + BEHAVIOR_SCORE',
      triggerEvent: meta?.triggerEvent || meta?.event || 'CREATE_PROFILE + BEHAVIOR_SCORE',
      triggerReason: meta?.triggerReason || 'Gợi ý cá nhân hóa thông minh',
      dataOrigin: meta?.dataOrigin || 'NEW',
      isCached: meta?.isCached ?? false,
      fromCache: meta?.fromCache ?? false,
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

    const packageSummary = packages
      .map(
        (p, idx) =>
          `     ${idx + 1}. [${p.sourceType || 'POPULAR'}] "${p.name}" (Ưu tiên: ${p.priority}, Tag: "${p.badge}")\n` +
          `        └─ Lý do: ${p.clinicalReason}`,
      )
      .join('\n');

    this.logger.log(
      `🏁 [REC-HOME: HOÀN TẤT PIPELINE]\n` +
      `  • Nguồn dữ liệu (Source): ${source}\n` +
      `  • Số lượng gói trả về: ${packages.length} gói\n` +
      `  • Thời gian xử lý: ${Date.now() - startTime}ms\n` +
      `  • Chi tiết các gói gợi ý:\n${packageSummary}`,
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
        this.analyzeAndCacheRecommendations(profileId, undefined, undefined, true).catch(() => { });
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
          this.redis.deletePattern(`rec:v2:home:prof:${profileId}*`),
          this.redis.deletePattern(`rec:v2:home:u:*:${profileId}`),
        ]);
      }
    } catch { }
  }

  async analyzeAndCacheRecommendations(
    profileId: string,
    actorId?: string,
    actorRole?: string,
    isInternal = false,
  ): Promise<ProfileRecommendationResponseDto> {
    if (!isInternal) {
      await this.assertProfileAccess(profileId, actorId, actorRole);
    }
    const profileTower = await this.candidateRetrievalService.getProfileCandidates(profileId, undefined, true);
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
      event: 'CREATE_PROFILE',
      triggerEvent: 'CREATE_PROFILE',
      triggerReason: 'Phân tích hồ sơ bệnh nhân',
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

  async getProfileCandidates(profileId?: string, preloadedPackages?: any[], skipCache = false) {
    return this.candidateRetrievalService.getProfileCandidates(profileId, preloadedPackages, skipCache);
  }

  async getBehaviorCandidates(userId?: string, sessionId?: string, preloadedPackages?: any[]) {
    return this.candidateRetrievalService.getBehaviorCandidates(userId, sessionId, preloadedPackages);
  }

  private buildHomeCacheKey(params: { userId?: string; sessionId?: string; profileId?: string }): string {
    if (params.userId) {
      const p = params.profileId || 'noprofile';
      return `rec:v2:home:u:${params.userId}:${p}`;
    }
    if (params.profileId) {
      return `rec:v2:home:prof:${params.profileId}`;
    }
    if (params.sessionId) {
      return `rec:v2:home:sess:${params.sessionId}`;
    }
    return 'rec:v2:home:generic';
  }

  private async assertProfileAccess(profileId: string, actorId?: string, actorRole?: string): Promise<void> {
    const profile = await this.prisma.patientProfile.findUnique({
      where: { id: profileId },
      select: { accountId: true },
    });
    if (!profile) throw new NotFoundException('Không tìm thấy hồ sơ bệnh nhân.');

    const staffRoles = ['ADMIN', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'RECEPTIONIST', 'DOCTOR'];
    if (!actorId || (!staffRoles.includes(String(actorRole).toUpperCase()) && profile.accountId !== actorId)) {
      throw new ForbiddenException('Bạn không có quyền truy cập gợi ý của hồ sơ này.');
    }
  }
}
