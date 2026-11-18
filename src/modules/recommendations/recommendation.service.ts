import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import { ProfileRecommendationResponseDto, RecommendedPackageItemDto, RecommendationSectionDto, ProfileRecommendationSectionDto } from './recommendation.dto.js';
import { CandidatePoolItem, RecommendationPackage, TELEMETRY_CONFIG } from './constants/recommendation.constants.js';
import { BehaviorTelemetryService } from './services/behavior-telemetry.service.js';
import type { BehaviorEvent } from './services/behavior-telemetry.service.js';
import { CandidateRetrievalService, ProfileRecommendationContext } from './services/candidate-retrieval.service.js';
import { AiRankingService, RankingContext } from './services/ai-ranking.service.js';
import { AnalyticsService } from '../analytics/analytics.service.js';

import type { CachedRanking, SourceRanking } from './types/ranking.types.js';
import { rankBehaviorCandidates } from './services/behavior-ranking.js';
import { isRoutineCheckupPackage } from './types/routine-checkup.js';
@Injectable()
export class RecommendationService {
  private readonly logger = new Logger(RecommendationService.name);
  private readonly inFlight = new Map<string, Promise<SourceRanking>>();
  private readonly profileAnalysisRequests = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly behaviorTelemetryService: BehaviorTelemetryService,
    private readonly candidateRetrievalService: CandidateRetrievalService,
    private readonly aiRankingService: AiRankingService,
    private readonly analytics: AnalyticsService,
  ) {}

  async getProfileRecommendations(profileId: string, sessionId?: string, userId?: string, userRole?: string): Promise<ProfileRecommendationSectionDto> {
    await this.assertProfileAccess(profileId, userId, userRole);
    const [catalog, context] = await Promise.all([
      this.candidateRetrievalService.loadActivePackages(),
      this.candidateRetrievalService.getProfileContext(profileId),
    ]);
    if (!context.profile) throw new NotFoundException('Không tìm thấy hồ sơ bệnh nhân.');
    const ranking = await this.getCachedProfileRanking(context, this.catalogFingerprint(catalog));
    const packages = this.getEligibleProfilePackages(ranking?.packages || [], catalog, context);
    return {
      ...this.toSection(packages, ranking, sessionId, userId),
      status: !ranking ? 'PENDING' : packages.length ? 'READY' : 'EMPTY',
      profileId, profileName: context.profile.fullName,
    };
  }

  async getBehaviorRecommendations(sessionId?: string, userId?: string): Promise<RecommendationSectionDto> {
    if (!userId && !sessionId) return this.toSection([]);
    const catalog = await this.candidateRetrievalService.loadActivePackages();
    const ranking = await this.getBehaviorRanking(catalog, userId, sessionId);
    const rows = ranking.packages.filter(item => ['DROP_OFF', 'SEARCH_INTENT', 'RECENT_VIEW'].includes(item.sourceType || ''));
    return this.toSection(this.refreshRankingItems(rows, catalog, 'BEHAVIOR'), ranking, sessionId, userId);
  }

  private toSection(packages: RecommendedPackageItemDto[], ranking?: SourceRanking, sessionId?: string, userId?: string): RecommendationSectionDto {
    return {
      status: packages.length ? 'READY' : 'EMPTY',
      updatedAt: ranking?.updatedAt || new Date().toISOString(),
      fromCache: ranking?.fromCache ?? false,
      packages,
      trackingToken: this.analytics.createRecommendationToken(packages, sessionId, userId),
    };
  }


  private async getCachedRanking(key: string, fingerprint?: string): Promise<SourceRanking | undefined> {
    if (!this.redis.isEnabled()) return undefined;
    try {
      const cached = await this.redis.get<CachedRanking>(key);
      if (cached && Array.isArray(cached.packages) && (!fingerprint || cached.fingerprint === fingerprint)) {
        return { ...cached, fromCache: true };
      }
    } catch { this.logger.debug('Prepared recommendation cache is unavailable'); }
    return undefined;
  }

  private async getCachedProfileRanking(profile: ProfileRecommendationContext, catalogVersion: string) {
    const cached = await this.getCachedRanking(this.profileCacheKey(profile.profile!.id), this.fingerprint({ catalogVersion, profile }));
    if (!cached) {
      const now = Date.now();
      // Polling a pending section must not enqueue the same analysis on every read.
      for (const [id, requestedAt] of this.profileAnalysisRequests) {
        if (now - requestedAt >= 60_000) this.profileAnalysisRequests.delete(id);
      }
      if (!this.profileAnalysisRequests.has(profile.profile!.id)) {
        this.profileAnalysisRequests.set(profile.profile!.id, now);
        this.triggerAsyncRecommendation(profile.profile!.id);
      }
    }
    return cached;
  }

  private getProfileRanking(profile: ProfileRecommendationContext, catalog: RecommendationPackage[], catalogVersion: string, force = false) {
    return this.getSourceRanking(
      this.profileCacheKey(profile.profile!.id),
      this.fingerprint({ catalogVersion, profile }), TELEMETRY_CONFIG.PROFILE_CACHE_TTL_SECONDS,

      async () => {
        const candidates = await this.candidateRetrievalService.getProfileCandidates(profile, catalog);
        return this.rankSource(candidates, {
          source: 'PROFILE', profile: {
            age: profile.age, gender: profile.gender, bmi: profile.bmi,
            medicalHistory: profile.medicalHistory, allergies: profile.allergies,
            familyHistory: profile.familyHistory,
            smokingStatus: profile.smokingStatus, alcoholUse: profile.alcoholUse, activityLevel: profile.activityLevel,
            pregnancyStatus: profile.pregnancyStatus, isBreastfeeding: profile.isBreastfeeding,
          }
        });
      }, force,
    );
  }

  private async getBehaviorRanking(
    catalog: RecommendationPackage[], userId?: string, sessionId?: string,
  ): Promise<SourceRanking> {
    const behavior = await this.behaviorTelemetryService.getBehaviorTelemetryContext(userId, sessionId);
    const fingerprint = createHash('sha256').update(JSON.stringify({
      policy: 'behavior-rules-v2-linear-views', behavior, catalog: this.catalogFingerprint(catalog),
      minute: Math.floor(Date.now() / 60000),
    })).digest('hex');
    
    return this.getSourceRanking(this.behaviorCacheKey(userId, sessionId), fingerprint,
      TELEMETRY_CONFIG.BEHAVIOR_CACHE_TTL_SECONDS, async () => {
        const { candidates } = await this.candidateRetrievalService.getBehaviorCandidates(userId, sessionId, catalog, behavior);
        return { source: 'BEHAVIOR_RULES', updatedAt: new Date().toISOString(),
          packages: rankBehaviorCandidates(candidates) };
      });
  }

  private async rankSource(candidates: CandidatePoolItem[], context: Omit<Extract<RankingContext, { source: 'PROFILE' }>, 'candidates'>) {
    const rankingContext: RankingContext = {
      ...context, candidates: candidates.map(item => ({
        id: item.pkg.id, code: item.pkg.code, slug: item.pkg.slug || undefined,
        name: item.pkg.name, description: item.pkg.description || '', price: Number(item.pkg.price),
        specialtyName: item.pkg.specialty?.name || 'Đa khoa', specialtyId: item.pkg.specialtyId,
        durationMin: item.pkg.durationMin, origin: item.origin, behaviorSourceType: item.behaviorSourceType,
        symptoms: item.pkg.symptoms || [], retrievalScore: item.retrievalScore, evidenceSignals: item.evidenceSignals,
        routineEligible: isRoutineCheckupPackage(item.pkg),
        viewCount: item.viewCount, lastViewedAt: item.lastViewedAt, searchQuery: item.searchQuery, searchedAt: item.searchedAt, abandonedAt: item.abandonedAt,
      }))
    };
    let packages: RecommendedPackageItemDto[] = [];
    let source: CachedRanking['source'] = 'RULE_FALLBACK';
    if (!candidates.length) return { source, updatedAt: new Date().toISOString(), packages };
    try {
      if (!this.aiRankingService.isAiAvailable()) throw new Error('AI unavailable');
      packages = await this.aiRankingService.rankWithOpenAI(rankingContext);
      source = 'AI_OPENAI'; // A successful empty selection is a valid answer.
    } catch {
      const grounded = candidates.filter(item => item.origin !== 'PROFILE'
        || (item.pkg.specialty?.name && item.evidenceSignals?.includes(item.pkg.specialty.name)));
      packages = this.aiRankingService.rankWithRules(grounded, context.source === 'PROFILE' ? context.profile.medicalHistory : '');
    }
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
        const cacheTtl = ranking.source !== 'RULE_FALLBACK' ? ttl : Math.min(ttl, TELEMETRY_CONFIG.RULE_CACHE_TTL_SECONDS);
        await this.redis.set(key, ranking, cacheTtl).catch(() => this.logger.debug('Unable to cache recommendation source'));
      }
      return { ...ranking, fromCache: false };
    })().finally(() => this.inFlight.delete(requestKey));
    this.inFlight.set(requestKey, request);
    return request;
  }

  private getEligibleProfilePackages(rows: RecommendedPackageItemDto[], catalog: RecommendationPackage[], profile: ProfileRecommendationContext) {
    const profileCatalog = catalog.filter(pkg =>
      this.candidateRetrievalService.isPackageEligibleForProfile(pkg, profile)
      && !profile.recentlyCompletedPackageIds.includes(pkg.id));
    return this.refreshRankingItems(rows, profileCatalog, 'PROFILE');
  }

  private refreshRankingItems(rows: RecommendedPackageItemDto[], catalog: RecommendationPackage[], source: 'PROFILE' | 'BEHAVIOR'): RecommendedPackageItemDto[] {
    const catalogById = new Map(catalog.map(pkg => [pkg.id, pkg]));
    const seen = new Set<number>();
    return rows.flatMap(item => {
      const pkg = catalogById.get(item.packageId);
      if (!pkg || seen.has(pkg.id)) return [];
      seen.add(pkg.id);
      return [{
        ...item, code: pkg.code, slug: pkg.slug || undefined, name: pkg.name, price: Number(pkg.price),
        durationMin: pkg.durationMin, specialtyId: pkg.specialtyId, specialtyName: pkg.specialty?.name || 'Đa khoa',
        sourceType: source === 'PROFILE' ? 'PROFILE_AI' as const : item.sourceType || 'RECENT_VIEW' as const
      }];
    }).slice(0, TELEMETRY_CONFIG.SOURCE_PACKAGES_LIMIT);
  }


  private behaviorScopeId(userId?: string, sessionId?: string): string | undefined {
    return userId ? `u:${userId}` : sessionId ? `g:${sessionId}` : undefined;
  }

  private behaviorCacheKey(userId?: string, sessionId?: string) {
    return TELEMETRY_CONFIG.CACHE_PREFIX + ':behavior-rules:' + this.behaviorScopeId(userId, sessionId);
  }

  triggerAsyncRecommendation(profileId: string): void {
    void this.prisma.outboxEvent.create({
      data: {
        aggregateType: 'PatientProfile', aggregateId: profileId,
        eventType: 'recommendation.profile.analyze', payload: { profileId },
      }
    }).catch(() => {
      setImmediate(() => { void this.analyzeAndCacheRecommendations(profileId, undefined, undefined, true).catch(() => { }); });
    });
  }

  async invalidateCache(profileId: string): Promise<void> {
    this.profileAnalysisRequests.delete(profileId);
    if (this.redis.isEnabled()) await this.redis.delete(this.profileCacheKey(profileId)).catch(() => { });
  }

  async analyzeAndCacheRecommendations(profileId: string, actorId?: string, actorRole?: string, isInternal = false): Promise<ProfileRecommendationResponseDto> {
    if (!isInternal) await this.assertProfileAccess(profileId, actorId, actorRole);
    const [catalog, context] = await Promise.all([
      this.candidateRetrievalService.loadActivePackages(), this.candidateRetrievalService.getProfileContext(profileId),
    ]);
    if (!context.profile) throw new NotFoundException('Không tìm thấy hồ sơ bệnh nhân.');
    const ranking = await this.getProfileRanking(context, catalog, this.catalogFingerprint(catalog), !isInternal);
    return {
      profileId, profileName: context.profile.fullName, updatedAt: ranking.updatedAt,
      source: ranking.source === 'AI_OPENAI' ? 'AI_OPENAI' : 'RULE_FALLBACK', event: 'PROFILE', triggerEvent: 'PROFILE', triggerReason: 'Phân tích riêng hồ sơ sức khỏe',
      packages: ranking.packages
    };
  }

  async trackUserBehavior(dto: BehaviorEvent, userId?: string) {
    const recorded = await this.behaviorTelemetryService.trackUserBehavior(dto, userId);
    return { success: recorded.success, recorded: recorded.recorded === true };
  }

  async recordAbandonedBooking(appointmentId: string): Promise<void> {
    await this.behaviorTelemetryService.recordAbandonedBooking(appointmentId);
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
      policy: TELEMETRY_CONFIG.POLICY_VERSION,
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
