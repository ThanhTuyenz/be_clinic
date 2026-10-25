import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import { HomeRecommendationQueryDto, HomeRecommendationResponseDto, ProfileRecommendationResponseDto, RecommendedPackageItemDto, TrackBehaviorDto } from './recommendation.dto.js';
import { CandidatePoolItem, RecommendationPackage, TELEMETRY_CONFIG } from './constants/recommendation.constants.js';
import { BehaviorTelemetryService } from './services/behavior-telemetry.service.js';
import { CandidateRetrievalService, ProfileRecommendationContext } from './services/candidate-retrieval.service.js';
import { AiRankingService, RankingContext } from './services/ai-ranking.service.js';
import { SemanticSearchService } from './services/semantic-search.service.js';
import { SearchAnalyticsService } from '../search-analytics/search-analytics.service.js';

interface CachedRanking {
  fingerprint: string;
  updatedAt: string;
  source: 'AI_OPENAI' | 'RULE_FALLBACK';
  packages: RecommendedPackageItemDto[];
}
type SourceRanking = CachedRanking & { fromCache: boolean };
type BehaviorContext = Awaited<ReturnType<BehaviorTelemetryService['getBehaviorTelemetryContext']>>;

@Injectable()
export class RecommendationService {
  private readonly logger = new Logger(RecommendationService.name);
  private readonly inFlight = new Map<string, Promise<SourceRanking>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly behaviorTelemetryService: BehaviorTelemetryService,
    private readonly candidateRetrievalService: CandidateRetrievalService,
    private readonly aiRankingService: AiRankingService,
    private readonly semanticSearchService: SemanticSearchService,
    private readonly analytics: SearchAnalyticsService,
  ) {}

  async getHomeRecommendations(query: HomeRecommendationQueryDto, userId?: string, userRole?: string): Promise<HomeRecommendationResponseDto> {
    if (query.profileId) await this.assertProfileAccess(query.profileId, userId, userRole);
    const [catalog, profile, behavior] = await Promise.all([
      this.candidateRetrievalService.loadActivePackages(),
      this.candidateRetrievalService.getProfileContext(query.profileId),
      userId ? this.behaviorTelemetryService.getBehaviorTelemetryContext(userId, query.sessionId) : undefined,
    ]);
    const catalogVersion = this.catalogFingerprint(catalog);
    const [profileRanking, behaviorRanking] = await Promise.all([
      profile.profile ? this.getProfileRanking(profile, catalog, catalogVersion) : undefined,
      behavior ? this.getBehaviorRanking(behavior, catalog, catalogVersion, userId, query.sessionId) : undefined,
    ]);
    // Recheck current catalog/profile constraints even when both rankings came from cache.
    const merged = await this.mergeRankings(profileRanking?.packages || [], behaviorRanking?.packages || [], catalog, profile);
    const source = merged.hasProfile && merged.hasBehavior ? 'HYBRID'
      : merged.hasProfile ? 'AI_PROFILE' : merged.hasBehavior ? 'BEHAVIOR' : 'FALLBACK';
    const activeRankings = [
      ...(merged.hasProfile && profileRanking ? [profileRanking] : []),
      ...(merged.hasBehavior && behaviorRanking ? [behaviorRanking] : []),
    ];
    const fromCache = activeRankings.length > 0 && activeRankings.every(item => item.fromCache);
    const event = source === 'HYBRID' ? 'MERGE_PROFILE_BEHAVIOR'
      : source === 'AI_PROFILE' ? 'PROFILE' : source === 'BEHAVIOR' ? 'BEHAVIOR' : 'DEFAULT_PACKAGES';
    return {
      profileId: query.profileId, profileName: profile.profile?.fullName,
      updatedAt: activeRankings.map(item => item.updatedAt).sort().at(-1) || new Date().toISOString(),
      source, event, triggerEvent: event,
      triggerReason: source === 'HYBRID' ? 'Kết hợp hai danh sách được phân tích độc lập theo hồ sơ và hành vi'
        : source === 'AI_PROFILE' ? 'Gợi ý theo hồ sơ sức khỏe'
        : source === 'BEHAVIOR' ? 'Gợi ý theo quan tâm gần đây' : 'Gói khám nổi bật và được khám nhiều trong 90 ngày gần nhất',
      dataOrigin: fromCache ? 'CACHE' : 'NEW', isCached: fromCache, fromCache,
      packages: merged.packages,
      trackingToken: this.analytics.createRecommendationToken(merged.packages, query.sessionId, userId),
    };
  }

  private getProfileRanking(profile: ProfileRecommendationContext, catalog: RecommendationPackage[], catalogVersion: string, force = false) {
    return this.getSourceRanking(
      this.profileCacheKey(profile.profile!.id),
      this.fingerprint({ catalogVersion, profile }), TELEMETRY_CONFIG.PROFILE_CACHE_TTL_SECONDS,
      async () => {
        const candidates = await this.candidateRetrievalService.getProfileCandidates(profile, catalog);
        return this.rankSource(candidates, { source: 'PROFILE', profile: {
          age: profile.age, gender: profile.gender, bmi: profile.bmi,
          medicalHistory: profile.medicalHistory, allergies: profile.allergies,
        } });
      }, force,
    );
  }

  private getBehaviorRanking(behavior: BehaviorContext, catalog: RecommendationPackage[], catalogVersion: string, userId?: string, sessionId?: string) {
    if ((!userId && !sessionId) || (!behavior.lastSearchQuery && !behavior.dropOffPkgId
      && !behavior.topSpecialties.some(item => item.score >= TELEMETRY_CONFIG.MIN_QUALIFIED_SCORE))) return undefined;
    const owner = userId ? 'u:' + userId + ':sess:' + (sessionId || 'none') : 'sess:' + sessionId;
    const context = { ...behavior, topSpecialties: [...behavior.topSpecialties].sort((a, b) => b.score - a.score || a.specialtyId - b.specialtyId) };
    return this.getSourceRanking(
      TELEMETRY_CONFIG.CACHE_PREFIX + ':behavior:' + owner,
      this.fingerprint({ catalogVersion, context }), TELEMETRY_CONFIG.BEHAVIOR_CACHE_TTL_SECONDS,
      async () => {
        const retrieved = await this.candidateRetrievalService.getBehaviorCandidates(userId, sessionId, catalog, context);
        const candidates: CandidatePoolItem[] = retrieved.candidates.map(item => ({
          pkg: item.pkg, origin: 'BEHAVIOR', behaviorSourceType: item.sourceType,
        }));
        return this.rankSource(candidates, { source: 'BEHAVIOR', behavior: {
          topSpecialties: context.topSpecialties.map(item => item.specialtyName + ' (' + item.score + ' điểm)').join(', '),
          lastSearchQuery: context.lastSearchQuery || '',
          dropOffPkgName: candidates.find(item => item.behaviorSourceType === 'DROP_OFF')?.pkg.name,
        } });
      },
    );
  }

  private async rankSource(candidates: CandidatePoolItem[], context: Omit<Extract<RankingContext, { source: 'PROFILE' }>, 'candidates'> | Omit<Extract<RankingContext, { source: 'BEHAVIOR' }>, 'candidates'>) {
    const rankingContext: RankingContext = { ...context, candidates: candidates.map(item => ({
      id: item.pkg.id, code: item.pkg.code, slug: item.pkg.slug || undefined,
      name: item.pkg.name, description: item.pkg.description || '', price: Number(item.pkg.price),
      specialtyName: item.pkg.specialty?.name || 'Đa khoa', specialtyId: item.pkg.specialtyId,
      durationMin: item.pkg.durationMin, origin: item.origin, behaviorSourceType: item.behaviorSourceType,
    })) };
    let packages = this.aiRankingService.isAiAvailable() && candidates.length
      ? await this.aiRankingService.rankWithOpenAI(rankingContext) : [];
    const source = packages.length ? 'AI_OPENAI' as const : 'RULE_FALLBACK' as const;
    if (!packages.length) packages = this.aiRankingService.rankWithRules(candidates, context.source === 'PROFILE' ? context.profile.medicalHistory : '');
    return { source, updatedAt: new Date().toISOString(), packages: packages.slice(0, TELEMETRY_CONFIG.SOURCE_PACKAGES_LIMIT) };
  }

  private async getSourceRanking(key: string, fingerprint: string, ttl: number, generate: () => Promise<Omit<CachedRanking, 'fingerprint'>>, force = false): Promise<SourceRanking> {
    if (!force && this.redis.isEnabled()) {
      try {
        const cached = await this.redis.get<CachedRanking>(key);
        if (cached?.fingerprint === fingerprint && Array.isArray(cached.packages)) return { ...cached, fromCache: true };
      } catch { this.logger.debug('Recommendation cache unavailable; generating source ranking'); }
    }
    const requestKey = key + ':' + fingerprint;
    const running = this.inFlight.get(requestKey);
    if (running) return running;
    const request = (async () => {
      const ranking: CachedRanking = { ...await generate(), fingerprint };
      if (this.redis.isEnabled()) {
        const cacheTtl = ranking.source === 'AI_OPENAI' ? ttl : Math.min(ttl, TELEMETRY_CONFIG.RULE_CACHE_TTL_SECONDS);
        await this.redis.set(key, ranking, cacheTtl).catch(() => this.logger.debug('Unable to cache recommendation source'));
      }
      return { ...ranking, fromCache: false };
    })().finally(() => this.inFlight.delete(requestKey));
    this.inFlight.set(requestKey, request);
    return request;
  }

  private async mergeRankings(profileRows: RecommendedPackageItemDto[], behaviorRows: RecommendedPackageItemDto[], catalog: RecommendationPackage[], profile: ProfileRecommendationContext) {
    const eligible = catalog.filter(pkg => this.candidateRetrievalService.isPackageEligibleForProfile(pkg, profile)
      && !profile.recentlyCompletedPackageIds.includes(pkg.id));
    const catalogById = new Map(eligible.map(pkg => [pkg.id, pkg]));
    const hydrate = (rows: RecommendedPackageItemDto[], source: 'PROFILE' | 'BEHAVIOR') => rows.flatMap(item => {
      const pkg = catalogById.get(item.packageId);
      if (!pkg) return [];
      return [{ ...item, code: pkg.code, slug: pkg.slug || undefined, name: pkg.name, price: Number(pkg.price),
        durationMin: pkg.durationMin, specialtyId: pkg.specialtyId, specialtyName: pkg.specialty?.name || 'Đa khoa',
        sourceType: source === 'PROFILE' ? 'PROFILE_AI' as const : item.sourceType || 'RECENT_VIEW' as const }];
    });
    const profiles = hydrate(profileRows, 'PROFILE'), behaviors = hydrate(behaviorRows, 'BEHAVIOR');
    const behaviorById = new Map(behaviors.map(item => [item.packageId, item]));
    const packages: RecommendedPackageItemDto[] = [], used = new Set<string>();
    const add = (item?: RecommendedPackageItemDto) => {
      if (!item || used.has(item.packageId) || packages.length >= TELEMETRY_CONFIG.HOME_FINAL_PACKAGES_LIMIT) return;
      used.add(item.packageId); packages.push(item);
    };
    for (const item of profiles) {
      const match = behaviorById.get(item.packageId);
      if (match) add({ ...item, sourceType: 'BOTH', priority: 'HIGH', badge: 'Phù hợp cả hai',
        clinicalReason: [...new Set([item.clinicalReason, match.clinicalReason].filter(Boolean))].join(' ') });
    }
    for (let index = 0; index < Math.max(profiles.length, behaviors.length); index++) {
      add(profiles[index]); add(behaviors[index]);
    }
    if (packages.length < TELEMETRY_CONFIG.HOME_FINAL_PACKAGES_LIMIT) {
      for (const item of await this.getFeaturedFallback(eligible)) add(item);
    }
    return { packages, hasProfile: profiles.length > 0, hasBehavior: behaviors.length > 0 };
  }

  private async getFeaturedFallback(eligible: RecommendationPackage[]): Promise<RecommendedPackageItemDto[]> {
    if (!eligible.length) return [];
    const now = new Date();
    const since = new Date(now.getTime() - TELEMETRY_CONFIG.POPULARITY_WINDOW_DAYS * 86400000);
    // Count appointments once, using completion history rather than booking/update dates.
    const completed = await this.prisma.appointment.groupBy({
      by: ['servicePackageId'],
      where: {
        servicePackageId: { in: eligible.map(pkg => pkg.id) },
        status: 'COMPLETED',
        statusHistories: { some: { toStatus: 'COMPLETED', createdAt: { gte: since, lte: now } } },
      },
      _count: { _all: true },
    });
    const counts = new Map(completed.map(row => [row.servicePackageId, row._count._all]));
    const sorted = [...eligible].sort((a, b) => Number(Boolean(b.isFeatured)) - Number(Boolean(a.isFeatured))
      || (counts.get(b.id) || 0) - (counts.get(a.id) || 0)
      || Number(a.price) - Number(b.price) || a.id.localeCompare(b.id));
    const featuredIds = new Set(eligible.filter(pkg => pkg.isFeatured).map(pkg => pkg.id));
    return this.aiRankingService.rankWithRules(sorted.map(pkg => ({ pkg, origin: 'POPULAR' })))
      .map(item => {
        const featured = featuredIds.has(item.packageId);
        const popular = (counts.get(item.packageId) || 0) > 0;
        return { ...item,
          badge: featured ? 'Gói khám nổi bật' : popular ? 'Được khám nhiều' : 'Gói khám tham khảo',
          clinicalReason: featured ? 'Gói khám nổi bật được VitaCare Clinic lựa chọn.'
            : popular ? 'Gói khám được nhiều bệnh nhân hoàn tất trong 90 ngày gần nhất.' : 'Gói khám hiện đang được cung cấp.',
        };
      });
  }

  triggerAsyncRecommendation(profileId: string): void {
    void this.prisma.outboxEvent.create({ data: {
      aggregateType: 'PatientProfile', aggregateId: profileId,
      eventType: 'recommendation.profile.analyze', payload: { profileId },
    } }).catch(() => {
      setImmediate(() => { void this.analyzeAndCacheRecommendations(profileId, undefined, undefined, true).catch(() => {}); });
    });
  }

  async invalidateCache(profileId: string): Promise<void> {
    if (this.redis.isEnabled()) await this.redis.delete(this.profileCacheKey(profileId)).catch(() => {});
  }

  async analyzeAndCacheRecommendations(profileId: string, actorId?: string, actorRole?: string, isInternal = false): Promise<ProfileRecommendationResponseDto> {
    if (!isInternal) await this.assertProfileAccess(profileId, actorId, actorRole);
    const [catalog, context] = await Promise.all([
      this.candidateRetrievalService.loadActivePackages(), this.candidateRetrievalService.getProfileContext(profileId),
    ]);
    if (!context.profile) throw new NotFoundException('Không tìm thấy hồ sơ bệnh nhân.');
    const ranking = await this.getProfileRanking(context, catalog, this.catalogFingerprint(catalog), !isInternal);
    return { profileId, profileName: context.profile.fullName, updatedAt: ranking.updatedAt,
      source: ranking.source, event: 'PROFILE', triggerEvent: 'PROFILE', triggerReason: 'Phân tích riêng hồ sơ sức khỏe',
      packages: ranking.packages };
  }

  trackUserBehavior(dto: TrackBehaviorDto, userId?: string) {
    return this.behaviorTelemetryService.trackUserBehavior(dto, userId);
  }

  semanticSearchPackages(query: string, branchId?: string, context: { sessionId?: string; accountId?: string } = {}) {
    return this.semanticSearchService.semanticSearchPackages(query, branchId, context);
  }

  suggestSymptomsForPackage(name: string, specialtyName?: string) {
    return this.aiRankingService.suggestSymptomsForPackage(name, specialtyName);
  }

  private profileCacheKey(profileId: string) {
    return TELEMETRY_CONFIG.CACHE_PREFIX + ':profile:' + profileId;
  }

  private fingerprint(value: unknown) {
    return createHash('sha256').update(JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-6-luna',
      embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
      candidateLimit: TELEMETRY_CONFIG.CANDIDATE_POOL_TARGET,
      resultLimit: TELEMETRY_CONFIG.SOURCE_PACKAGES_LIMIT, value,
    })).digest('hex');
  }

  private catalogFingerprint(catalog: RecommendationPackage[]) {
    // Views update viewCount/updatedAt; those changes must not invalidate profile analysis.
    return this.fingerprint(catalog.map(pkg => ({
      id: pkg.id, code: pkg.code, slug: pkg.slug, name: pkg.name, description: pkg.description,
      price: Number(pkg.price), durationMin: pkg.durationMin, specialty: pkg.specialty, symptoms: pkg.symptoms,
      targetGender: pkg.targetGender, minAge: pkg.minAge, maxAge: pkg.maxAge, isPediatric: pkg.isPediatric,
      isFollowUp: pkg.isFollowUp, followUpAfterDays: pkg.followUpAfterDays,
    })));
  }

  private async assertProfileAccess(profileId: string, actorId?: string, actorRole?: string): Promise<void> {
    const profile = await this.prisma.patientProfile.findUnique({ where: { id: profileId }, select: { accountId: true } });
    if (!profile) throw new NotFoundException('Không tìm thấy hồ sơ bệnh nhân.');
    const staffRoles = ['CHAIN_MANAGER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'RECEPTIONIST', 'DOCTOR'];
    if (!actorId || (!staffRoles.includes(String(actorRole).toUpperCase()) && profile.accountId !== actorId)) {
      throw new ForbiddenException('Bạn không có quyền truy cập gợi ý của hồ sơ này.');
    }
  }
}
