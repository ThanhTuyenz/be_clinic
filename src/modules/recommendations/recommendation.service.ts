import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI, Type } from '@google/genai';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import {
  ProfileRecommendationResponseDto,
  RecommendedPackageItemDto,
  RecommendationPriority,
  TrackBehaviorDto,
  TrackingActionType,
  HomeRecommendationQueryDto,
  HomeRecommendationResponseDto,
} from './recommendation.dto.js';
import { EmbeddingService, PackageForRetrieval } from '../../infrastructure/embedding/embedding.service.js';

interface CandidatePoolItem {
  pkg: any;
  origin: 'PROFILE' | 'BEHAVIOR' | 'BOTH' | 'POPULAR';
  behaviorSourceType?: 'SEARCH_INTENT' | 'DROP_OFF' | 'RECENT_VIEW';
  isFollowUp?: boolean;
}

@Injectable()
export class RecommendationService {
  private readonly logger = new Logger(RecommendationService.name);
  private aiClient: GoogleGenAI | null = null;
  private readonly modelName: string;
  private readonly CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 ngày

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly embeddingService: EmbeddingService,
  ) {
    const apiKey = this.config.get<string>('gemini.apiKey') || process.env.GEMINI_API_KEY;
    this.modelName = this.config.get<string>('gemini.model') || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    if (apiKey) {
      try {
        this.aiClient = new GoogleGenAI({ apiKey });
      } catch (err: any) {
        this.logger.warn(`Failed to initialize GoogleGenAI: ${err?.message}`);
      }
    } else {
      this.logger.warn('GEMINI_API_KEY not found; will use Rule-based clinical fallback');
    }
  }

  // ===================================================================================
  // NHÁNH 1: HỒ SƠ BỆNH ÁN (Profile Tower - Vector Retrieval)
  // ===================================================================================

  /**
   * Lấy danh sách gói ứng viên từ Hồ sơ bệnh nhân (Top 6 - 8 gói)
   */
  async getProfileCandidates(
    profileId?: string,
    branchId?: string,
    preloadedPackages?: any[],
  ): Promise<{
    profile: any;
    age: number;
    gender: string;
    bmi: number | null;
    medicalHistory: string;
    allergies: string;
    candidates: Array<{ pkg: any; isFollowUp?: boolean }>;
  }> {
    const emptyResult = {
      profile: null,
      age: 30,
      gender: 'OTHER',
      bmi: null,
      medicalHistory: '',
      allergies: '',
      candidates: [],
    };

    if (!profileId) return emptyResult;

    const profile = await this.prisma.patientProfile.findUnique({
      where: { id: profileId },
      select: {
        id: true,
        fullName: true,
        dateOfBirth: true,
        gender: true,
        height: true,
        weight: true,
        medicalHistory: true,
        allergies: true,
      },
    });

    if (!profile) return emptyResult;

    const dob = profile.dateOfBirth ? new Date(profile.dateOfBirth) : null;
    const age = dob && !isNaN(dob.getTime())
      ? Math.abs(new Date(Date.now() - dob.getTime()).getUTCFullYear() - 1970)
      : 30;
    const height = profile.height ? Number(profile.height) : 0;
    const weight = profile.weight ? Number(profile.weight) : 0;
    const bmi = height > 50 && weight > 10 ? +(weight / ((height / 100) * (height / 100))).toFixed(1) : null;
    const medicalHistory = (profile.medicalHistory || '').trim();
    const allergies = (profile.allergies || '').trim();
    const gender = (profile.gender || 'OTHER').toString().toUpperCase();

    // 1. Kiểm tra lịch sử tái khám
    const pastAppointments = await this.prisma.appointment.findMany({
      where: {
        patientProfileId: profileId,
        status: 'COMPLETED',
      },
      include: {
        servicePackage: { select: { id: true, name: true, code: true, specialtyId: true, specialty: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 3,
    });

    const candidates: Array<{ pkg: any; isFollowUp?: boolean }> = [];

    // Tái dùng danh sách gói đã load sẵn (tránh query N+1 khi gọi từ Orchestrator)
    const allPackages = preloadedPackages ?? await this.prisma.servicePackage.findMany({
      where: {
        isActive: true,
        ...(branchId ? { branchBookingMethod: { branchId, isEnabled: true } } : {}),
      },
      include: { specialty: { select: { id: true, name: true, slug: true } } },
      orderBy: { price: 'asc' },
    });

    if (pastAppointments.length > 0) {
      const latest = pastAppointments[0];
      const specId = latest.servicePackage?.specialtyId;
      if (specId) {
        const followUpPkg = allPackages.find(
          (p) => p.specialtyId === specId && (p.code.endsWith('-FOLLOWUP') || p.name.toLowerCase().includes('tái khám')),
        );
        if (followUpPkg) {
          candidates.push({ pkg: followUpPkg, isFollowUp: true });
        }
      }
    }

    // 2. Lọc độ tuổi & giới tính
    const validScreening = allPackages.filter((pkg) => {
      if (pkg.code.endsWith('-FOLLOWUP') || pkg.name.toLowerCase().includes('tái khám')) return false;
      if (!this.isPackageAppropriateForGender(pkg.name, pkg.description || '', gender)) return false;
      if (!this.isPackageAppropriateForAge(pkg.name, pkg.description || '', age)) return false;
      return true;
    });

    // 3. Vector Similarity Search
    const patientEmbeddingText = this.embeddingService.buildPatientEmbeddingText({
      fullName: profile.fullName,
      age,
      gender,
      bmi,
      medicalHistory,
      allergies,
    });

    const candidateObjects: PackageForRetrieval[] = validScreening.map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      description: p.description || '',
      symptoms: p.symptoms || [],
      price: Number(p.price),
      specialtyName: p.specialty?.name || 'Đa khoa',
      specialtyId: p.specialtyId,
      durationMin: p.durationMin,
    }));

    const topRetrieved = await this.embeddingService.retrieveTopPackages(patientEmbeddingText, candidateObjects, 8);
    for (const r of topRetrieved) {
      const match = allPackages.find((p) => p.id === r.package.id);
      if (match && !candidates.some((item) => item.pkg.id === match.id)) {
        candidates.push({ pkg: match });
      }
    }

    return {
      profile,
      age,
      gender,
      bmi,
      medicalHistory,
      allergies,
      candidates,
    };
  }

  // ===================================================================================
  // NHÁNH 2: HÀNH VI TELEMETRY (Behavior Tower - Redis Score >= 6)
  // ===================================================================================

  /**
   * Lấy danh sách gói ứng viên từ Hành vi Redis (Top 4 - 6 gói khi điểm >= 6)
   */
  async getBehaviorCandidates(
    userId?: string,
    sessionId?: string,
    branchId?: string,
    preloadedPackages?: any[],
  ): Promise<{
    topSpecialties: Array<{ specialtyId: number; specialtyName: string; score: number }>;
    lastSearchQuery?: string;
    dropOffPkgId?: string;
    candidates: Array<{ pkg: any; sourceType: 'SEARCH_INTENT' | 'DROP_OFF' | 'RECENT_VIEW' }>;
  }> {
    const context = await this.getBehaviorTelemetryContext(userId, sessionId);
    const candidates: Array<{ pkg: any; sourceType: 'SEARCH_INTENT' | 'DROP_OFF' | 'RECENT_VIEW' }> = [];

    // Tái dùng danh sách gói đã load sẵn (tránh query N+1 khi gọi từ Orchestrator)
    const allPackages = preloadedPackages ?? await this.prisma.servicePackage.findMany({
      where: {
        isActive: true,
        ...(branchId ? { branchBookingMethod: { branchId, isEnabled: true } } : {}),
      },
      include: { specialty: { select: { id: true, name: true, slug: true } } },
      orderBy: { price: 'asc' },
    });

    // 1. Ưu tiên gói bỏ dở nếu có (Drop-off Package)
    if (context.dropOffPkgId) {
      const dropOffMatch = allPackages.find((p) => p.id === context.dropOffPkgId);
      if (dropOffMatch) {
        candidates.push({ pkg: dropOffMatch, sourceType: 'DROP_OFF' });
      }
    }

    // 2. Trích xuất gói từ chuyên khoa đạt điểm >= 6
    const qualifiedSpecialties = context.topSpecialties.filter((s) => s.score >= 6);
    for (const spec of qualifiedSpecialties.slice(0, 2)) {
      const specPackages = allPackages.filter((p) => p.specialtyId === spec.specialtyId);
      for (const p of specPackages.slice(0, 3)) {
        if (!candidates.some((c) => c.pkg.id === p.id)) {
          candidates.push({
            pkg: p,
            sourceType: context.lastSearchQuery ? 'SEARCH_INTENT' : 'RECENT_VIEW',
          });
        }
      }
    }

    // 3. Nếu có lastSearchQuery -> Tìm kiếm ngữ nghĩa bổ sung
    if (context.lastSearchQuery && candidates.length < 6) {
      try {
        const searchPackages: PackageForRetrieval[] = allPackages.map((p) => ({
          id: p.id,
          code: p.code,
          name: p.name,
          description: p.description || '',
          symptoms: p.symptoms || [],
          price: Number(p.price),
          durationMin: p.durationMin,
          specialtyId: p.specialtyId,
          specialtyName: p.specialty?.name || 'Đa khoa',
        }));
        const searchResults = await this.embeddingService.searchByNaturalLanguage(context.lastSearchQuery, searchPackages, 3);
        for (const sr of searchResults) {
          const match = allPackages.find((p) => p.id === sr.package.id);
          if (match && !candidates.some((c) => c.pkg.id === match.id)) {
            candidates.push({ pkg: match, sourceType: 'SEARCH_INTENT' });
          }
        }
      } catch (err: any) {
        this.logger.warn(`Semantic search for behavior query failed: ${err?.message}`);
      }
    }

    return {
      topSpecialties: context.topSpecialties,
      lastSearchQuery: context.lastSearchQuery,
      dropOffPkgId: context.dropOffPkgId,
      candidates,
    };
  }

  // ===================================================================================
  // HÀM ĐIỀU PHỐI CHÍNH: TỔNG HỢP 2 NHÁNH & GEMINI RE-RANKING CHO TRANG CHỦ
  // ===================================================================================

  /**
   * Tổng hợp gói khám đề xuất cho Trang Chủ (Two-Tower Orchestrator)
   */
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

    // 0. Cache Check (5 phút)
    try {
      if (this.redis.isEnabled()) {
        const cached = await this.redis.get<HomeRecommendationResponseDto>(homeCacheKey);
        if (cached && Array.isArray(cached.packages) && cached.packages.length > 0) {
          return cached;
        }
      }
    } catch {}

    // 1. Load toàn bộ gói khám 1 LẦN DUY NHẤT, sau đó truyền vào cả 2 nhánh (tránh N+1 query)
    const allActivePackages = await this.prisma.servicePackage.findMany({
      where: {
        isActive: true,
        ...(query.branchId ? { branchBookingMethod: { branchId: query.branchId, isEnabled: true } } : {}),
      },
      include: { specialty: { select: { id: true, name: true, slug: true } } },
      orderBy: { price: 'asc' },
    });

    // 2. Gọi song song 2 nhánh, truyền allActivePackages đã load sẵn
    const [profileTower, behaviorTower] = await Promise.all([
      this.getProfileCandidates(query.profileId, query.branchId, allActivePackages),
      this.getBehaviorCandidates(userId, query.sessionId, query.branchId, allActivePackages),
    ]);

    // 2. Gộp & Khử trùng Candidate Pool (Top 8 - 14 gói)
    const candidatePoolMap = new Map<string, CandidatePoolItem>();

    // 2.1. Nạp từ Nhánh Hồ sơ
    for (const item of profileTower.candidates) {
      candidatePoolMap.set(item.pkg.id, {
        pkg: item.pkg,
        origin: 'PROFILE',
        isFollowUp: item.isFollowUp,
      });
    }

    // 2.2. Nạp từ Nhánh Hành vi
    for (const beh of behaviorTower.candidates) {
      if (candidatePoolMap.has(beh.pkg.id)) {
        const existing = candidatePoolMap.get(beh.pkg.id)!;
        existing.origin = 'BOTH';
        existing.behaviorSourceType = beh.sourceType;
      } else {
        if (profileTower.profile) {
          if (!this.isPackageAppropriateForGender(beh.pkg.name, beh.pkg.description || '', profileTower.gender)) continue;
          if (!this.isPackageAppropriateForAge(beh.pkg.name, beh.pkg.description || '', profileTower.age)) continue;
        }
        candidatePoolMap.set(beh.pkg.id, {
          pkg: beh.pkg,
          origin: 'BEHAVIOR',
          behaviorSourceType: beh.sourceType,
        });
      }
    }

    // 2.3. Bổ sung nếu chưa đủ 8 gói
    if (candidatePoolMap.size < 8) {
      for (const p of allActivePackages) {
        if (!candidatePoolMap.has(p.id)) {
          if (profileTower.profile) {
            if (!this.isPackageAppropriateForGender(p.name, p.description || '', profileTower.gender)) continue;
            if (!this.isPackageAppropriateForAge(p.name, p.description || '', profileTower.age)) continue;
          }
          candidatePoolMap.set(p.id, { pkg: p, origin: 'POPULAR' });
          if (candidatePoolMap.size >= 12) break;
        }
      }
    }

    const candidatePoolArray = Array.from(candidatePoolMap.values());

    // 3. Đưa Candidate Pool vào Gemini LLM Re-ranking (Chọn Top 4 - 6 gói)
    let reRankedPackages: RecommendedPackageItemDto[] = [];
    const hasBehaviorIntent = behaviorTower.candidates.length > 0;
    const hasProfileIntent = !!profileTower.profile;

    let detectedSource: 'HYBRID' | 'AI_PROFILE' | 'BEHAVIOR' | 'FALLBACK' = 'FALLBACK';
    if (hasProfileIntent && hasBehaviorIntent) detectedSource = 'HYBRID';
    else if (hasProfileIntent) detectedSource = 'AI_PROFILE';
    else if (hasBehaviorIntent) detectedSource = 'BEHAVIOR';

    // Chỉ gọi Gemini khi CÓ BỆNH ÁN hoặc CÓ HÀNH VI QUAN TÂM (tránh tốn chi phí & latency cho khách mới chưa có context)
    if (this.aiClient && candidatePoolArray.length > 0 && (hasProfileIntent || hasBehaviorIntent)) {
      try {
        reRankedPackages = await this.evaluateHybridWithGemini({
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
            topSpecialties: behaviorTower.topSpecialties.map((s) => `${s.specialtyName} (${s.score} điểm)`).join(', ') || 'Chưa ghi nhận',
            lastSearchQuery: behaviorTower.lastSearchQuery || 'Không có',
            dropOffPkgName: candidatePoolArray.find((c) => c.origin === 'BEHAVIOR' && c.behaviorSourceType === 'DROP_OFF')?.pkg.name,
          },
          candidates: candidatePoolArray.map((c) => ({
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
      } catch (err: any) {
        this.logger.warn(`Gemini Re-ranking failed (${err?.message}) -> Fallback heuristics`);
      }
    }

    // 4. Fallback Heuristics nếu AI lỗi hoặc trường hợp khách vãng lai thuần túy
    if (reRankedPackages.length === 0) {
      reRankedPackages = this.evaluateHybridWithHeuristics(candidatePoolArray, profileTower.profile, profileTower.medicalHistory);
    }

    const finalResultPackages = reRankedPackages.slice(0, 6);

    const finalResponse: HomeRecommendationResponseDto = {
      profileId: query.profileId,
      profileName: profileTower.profile?.fullName,
      updatedAt: new Date().toISOString(),
      source: detectedSource,
      packages: finalResultPackages,
    };

    // 5. Lưu Cache Redis (5 - 15 phút tùy độ cá nhân hóa)
    try {
      if (this.redis.isEnabled() && finalResultPackages.length > 0) {
        const ttl = detectedSource === 'FALLBACK' ? 900 : 300; // Khách vãng lai cache 15 phút, cá nhân hóa cache 5 phút
        await this.redis.set(homeCacheKey, finalResponse, ttl);
      }
    } catch {}

    this.logger.log(
      `🏁 [HYBRID PIPELINE] Source: ${detectedSource} | ${finalResultPackages.length} pkgs | Time: ${Date.now() - t0}ms`,
    );

    return finalResponse;
  }

  // ===================================================================================
  // TRANG HỒ SƠ BỆNH NHÂN (Profile Page API & Outbox)
  // ===================================================================================

  async getRecommendations(profileId: string, branchId?: string): Promise<ProfileRecommendationResponseDto> {
    const cacheKey = this.buildCacheKey(profileId);
    try {
      if (this.redis.isEnabled()) {
        const cached = await this.redis.get<ProfileRecommendationResponseDto>(cacheKey);
        if (cached && Array.isArray(cached.packages) && cached.packages.length > 0) {
          return { ...cached, source: 'REDIS_CACHE' };
        }
      }
    } catch {}

    return this.analyzeAndCacheRecommendations(profileId, branchId);
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
        this.analyzeAndCacheRecommendations(profileId).catch(() => {});
      });
    }
  }

  async invalidateCache(profileId: string): Promise<void> {
    try {
      if (this.redis.isEnabled()) {
        const key = this.buildCacheKey(profileId);
        await this.redis.delete(key);
        await this.redis.delete(`${key}:all`);
      }
    } catch {}
  }

  async analyzeAndCacheRecommendations(
    profileId: string,
    branchId?: string,
  ): Promise<ProfileRecommendationResponseDto> {
    const profileTower = await this.getProfileCandidates(profileId, branchId);
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

    if (this.aiClient && candidateObjects.length > 0) {
      try {
        aiList = await this.evaluateHybridWithGemini({
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
      } catch {}
    }

    if (aiList.length === 0) {
      aiList = this.evaluateHybridWithHeuristics(
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
        await this.redis.set(this.buildCacheKey(profileId), result, this.CACHE_TTL_SECONDS);
      } catch {}
    }

    return result;
  }

  // ===================================================================================
  // TELEMETRY & TÌM KIẾM
  // ===================================================================================

  async trackUserBehavior(dto: TrackBehaviorDto, userId?: string): Promise<{ success: boolean }> {
    let resolvedSpecialtyId = dto.targetSpecialtyId;
    if (!resolvedSpecialtyId && dto.targetPackageId) {
      try {
        const pkg = await this.prisma.servicePackage.findUnique({
          where: { id: dto.targetPackageId },
          select: { specialtyId: true },
        });
        if (pkg?.specialtyId) resolvedSpecialtyId = pkg.specialtyId;
      } catch {}
    }

    if (!this.redis.isEnabled()) return { success: true };

    const keys: string[] = [];
    if (userId) keys.push(`rec:user_interest:${userId}`);
    if (dto.sessionId) keys.push(`rec:guest_interest:${dto.sessionId}`);

    const BEHAVIOR_TTL = 14 * 24 * 60 * 60;
    const MAX_SCORE_CAP = 15;

    for (const key of keys) {
      try {
        let delta = 0;
        if (dto.actionType === TrackingActionType.SEARCH) delta = 5;
        else if (dto.actionType === TrackingActionType.VIEW_PACKAGE) delta = 3;
        else if (dto.actionType === TrackingActionType.DROP_OFF) delta = 8;

        if (resolvedSpecialtyId && delta > 0) {
          const field = `specialty:${resolvedSpecialtyId}`;
          const client = this.redis.getClient();
          if (client) {
            // Atomic Lua Script: Đọc và cộng điểm có chặn trần MAX_SCORE_CAP tránh race condition
            const luaScript = `
              local current = tonumber(redis.call('HGET', KEYS[1], ARGV[1]) or '0')
              local cap = tonumber(ARGV[3])
              local nextVal = math.min(cap, current + tonumber(ARGV[2]))
              redis.call('HSET', KEYS[1], ARGV[1], tostring(nextVal))
              return nextVal
            `;
            await client.eval(luaScript, 1, key, field, delta.toString(), MAX_SCORE_CAP.toString());
          } else {
            const newScore = await this.redis.hincrby(key, field, delta);
            if (newScore > MAX_SCORE_CAP) {
              await this.redis.hset(key, field, MAX_SCORE_CAP.toString());
            }
          }
        }

        if (dto.searchQuery) await this.redis.hset(key, 'last_search_query', dto.searchQuery);
        if (dto.actionType === TrackingActionType.VIEW_PACKAGE && dto.targetPackageId) {
          await this.redis.hset(key, 'last_viewed_pkg', dto.targetPackageId);
        }
        if (dto.actionType === TrackingActionType.DROP_OFF && dto.targetPackageId) {
          await this.redis.hset(key, 'drop_off_pkg', dto.targetPackageId);
        }

        await this.redis.expire(key, BEHAVIOR_TTL);
      } catch {}
    }

    // Global Aggregate Telemetry for Hospital BI & Analytics
    try {
      const client = this.redis.getClient();
      if (client) {
        if (dto.searchQuery && dto.searchQuery.trim().length >= 2) {
          await client.zincrby('rec:global:search_queries', 1, dto.searchQuery.trim().toLowerCase());
        }
        if (dto.actionType === TrackingActionType.VIEW_PACKAGE && dto.targetPackageId) {
          await client.zincrby('rec:global:package_views', 1, dto.targetPackageId);
        }
        if (resolvedSpecialtyId) {
          await client.zincrby('rec:global:specialty_views', 1, resolvedSpecialtyId.toString());
        }
      }
    } catch {}

    // Invalidate cached home recommendations for this user/session so new actions reflect immediately
    try {
      if (userId) {
        await this.redis.deletePattern(`rec:home:u:${userId}:*`);
      }
      if (dto.sessionId) {
        await this.redis.deletePattern(`rec:home:sess:${dto.sessionId}:*`);
      }
    } catch {}

    return { success: true };
  }

  async semanticSearchPackages(query: string, branchId?: string) {
    if (!query || !query.trim()) return { query: '', total: 0, packages: [], doctors: [], branches: [] };
    const q = query.trim();

    const [packages, matchedDoctors, matchedBranches] = await Promise.all([
      (async () => {
        const pkgs = await this.prisma.servicePackage.findMany({
          where: {
            isActive: true,
            ...(branchId ? { branchBookingMethod: { branchId, isEnabled: true } } : {}),
          },
          include: { specialty: { select: { id: true, name: true } } },
          orderBy: { price: 'asc' },
        });

        const mapped: PackageForRetrieval[] = pkgs.map((p) => ({
          id: p.id,
          code: p.code,
          name: p.name,
          description: p.description || '',
          symptoms: p.symptoms || [],
          price: Number(p.price),
          durationMin: p.durationMin,
          specialtyId: p.specialtyId,
          specialtyName: p.specialty?.name || 'Đa khoa',
        }));

        const results = await this.embeddingService.searchByNaturalLanguage(q, mapped, 6);
        return results.map((r) => ({
          id: r.package.id,
          code: r.package.code,
          name: r.package.name,
          price: r.package.price,
          durationMin: r.package.durationMin,
          specialtyName: r.package.specialtyName,
          similarityScore: Math.round(r.score * 100) / 100,
          description: r.package.description,
        }));
      })(),

      this.prisma.doctor.findMany({
        where: {
          isActive: true,
          OR: [
            { user: { fullName: { contains: q, mode: 'insensitive' } } },
            { academicRank: { contains: q, mode: 'insensitive' } },
            { specialties: { some: { specialty: { name: { contains: q, mode: 'insensitive' } } } } },
          ],
        },
        take: 4,
        include: {
          user: { select: { id: true, fullName: true, phoneNumber: true, email: true } },
          specialties: { include: { specialty: { select: { id: true, name: true } } } },
        },
      }),

      this.prisma.branch.findMany({
        where: {
          isActive: true,
          OR: [{ name: { contains: q, mode: 'insensitive' } }, { address: { contains: q, mode: 'insensitive' } }],
        },
        take: 3,
        select: { id: true, code: true, name: true, address: true, phoneNumber: true },
      }),
    ]);

    const finalResult = {
      query: q,
      total: packages.length + matchedDoctors.length + matchedBranches.length,
      packages,
      doctors: matchedDoctors.map((doc) => ({
        id: doc.id,
        fullName: doc.user?.fullName || 'Bác sĩ',
        academicRank: doc.academicRank || 'Bác sĩ',
        specialties: doc.specialties.map((s) => s.specialty?.name).filter(Boolean) as string[],
        experienceYears: doc.experienceYears || 0,
        avatarUrl: doc.avatarUrl || null,
        ratingAverage: doc.ratingAverage || 5.0,
      })),
      branches: matchedBranches,
    };

    // Telemetry: Lưu từ khóa và cờ hasResults vào Redis
    try {
      const client = this.redis.getClient();
      if (client && q.length >= 2) {
        const normalizedQ = q.toLowerCase();
        if (packages.length > 0) {
          await client.zincrby('rec:global:search_queries', 1, normalizedQ);
        } else {
          await client.zincrby('rec:global:unmatched_queries', 1, normalizedQ);
        }
      }
    } catch {}

    return finalResult;
  }

  async suggestSymptomsForPackage(name: string, specialtyName?: string): Promise<{ symptoms: string[] }> {
    if (!name?.trim()) return { symptoms: [] };
    if (this.aiClient) {
      try {
        const prompt = `Bạn là trợ lý y khoa AI của phòng khám VitaCare.
Hãy phân tích dịch vụ / gói khám: "${name.trim()}" (Chuyên khoa: "${specialtyName?.trim() || 'Đa khoa'}").
Liệt kê 10-15 triệu chứng lâm sàng phổ biến nhất bằng JSON array các chuỗi string ngắn gọn: ["triệu chứng 1", "triệu chứng 2", ...]`;
        const res = await this.aiClient.models.generateContent({
          model: this.modelName || 'gemini-2.5-flash',
          contents: prompt,
        });
        let raw = res.text?.trim() || '[]';
        if (raw.startsWith('```')) raw = raw.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return { symptoms: [...new Set(parsed.map((s: any) => String(s).trim().toLowerCase()))] };
        }
      } catch {}
    }
    return { symptoms: [] };
  }

  // ===================================================================================
  // HELPER METHODS: GEMINI EVALUATION & HEURISTICS
  // ===================================================================================

  private async evaluateHybridWithGemini(context: {
    profile: {
      fullName: string;
      age: number;
      gender: string;
      bmi: number | null;
      medicalHistory: string;
      allergies: string;
    } | null;
    behaviorContext: {
      topSpecialties: string;
      lastSearchQuery: string;
      dropOffPkgName?: string;
    };
    candidates: Array<{
      id: string;
      name: string;
      code: string;
      slug?: string;
      description: string;
      price: number;
      specialtyName: string;
      specialtyId: number | null;
      durationMin: number;
      origin: string;
      behaviorSourceType?: string;
    }>;
  }): Promise<RecommendedPackageItemDto[]> {
    if (!this.aiClient) return [];

    const prompt = `
Bạn là Bác sĩ Trưởng Hội đồng Khám sàng lọc & Y học Dự phòng tại VitaCare Clinic.
Hãy đánh giá hồ sơ bệnh nhân và hành vi quan tâm gần đây để Re-rank và chọn ra từ 4 đến 6 gói khám y tế tối ưu nhất từ danh sách ứng viên được cung cấp.

THÔNG TIN BỆNH NHÂN:
${context.profile ? `
- Họ tên: ${context.profile.fullName}
- Tuổi: ${context.profile.age} tuổi
- Giới tính: ${context.profile.gender}
- Chỉ số BMI: ${context.profile.bmi ?? 'Chưa ghi nhận'}
- Tiền sử bệnh án mạn tính: "${context.profile.medicalHistory || 'Không ghi nhận'}"
- Tiền sử dị ứng: "${context.profile.allergies || 'Không ghi nhận'}"
` : 'Khách vãng lai (Chưa đăng nhập / Chưa chọn hồ sơ).'}

NGỮ CẢNH HÀNH VI TƯƠNG TÁC TỨC THỜI:
- Chuyên khoa có điểm quan tâm cao: ${context.behaviorContext.topSpecialties}
- Từ khóa tìm kiếm triệu chứng gần nhất: "${context.behaviorContext.lastSearchQuery}"
${context.behaviorContext.dropOffPkgName ? `- Gói khám từng quan tâm/bỏ dở: "${context.behaviorContext.dropOffPkgName}"` : ''}

DANH SÁCH GÓI KHÁM ỨNG VIÊN (${context.candidates.length} gói):
${JSON.stringify(
  context.candidates.map((c) => ({
    id: c.id,
    name: c.name,
    specialty: c.specialtyName,
    price: c.price,
    origin: c.origin,
    behaviorSourceType: c.behaviorSourceType || 'NONE',
    description: (c.description || '').slice(0, 100),
  }))
)}

QUY TẮC RE-RANKING:
1. SỐ LƯỢNG KẾT QUẢ: Chọn ra từ 4 đến 6 gói khám phù hợp nhất.
2. NGUYÊN TẮC ĐỀ XUẤT:
   - Nếu CÓ HỒ SƠ: Ưu tiên theo tiền sử/bệnh nền, tuổi tác và giới tính của hồ sơ.
   - Nếu LÀ HÀNH VI/KHÁCH VÃNG LAI: Ưu tiên theo mối quan tâm chuyên khoa, từ khóa tìm kiếm và các gói vừa quan tâm gần đây.
3. PHÂN LOẠI NGUỒN GỢI Ý (sourceType): "DROP_OFF" | "SEARCH_INTENT" | "RECENT_VIEW" | "PROFILE_AI" | "POPULAR".
4. MỨC ĐỘ ƯU TIÊN (priority): "HIGH" | "MEDIUM" | "LOW".
5. NHÃN (badge): Ngắn gọn 2-4 từ (Ví dụ: "Theo hồ sơ bệnh án", "Nhu cầu vừa tìm", "Quan tâm gần đây", "Tầm soát định kỳ").
6. LÝ DO ĐỀ XUẤT (clinicalReason): Viết 1-2 câu giải thích chuyên môn y khoa sâu sắc:
   - Khi có hồ sơ: Nêu rõ căn cứ theo độ tuổi và tiền sử bệnh của bệnh nhân.
   - Khi theo hành vi: Giải thích dựa trên nhu cầu tìm kiếm và chuyên khoa người dùng vừa quan tâm gần đây.
`;

    const response = await this.aiClient.models.generateContent({
      model: this.modelName,
      contents: prompt,
      config: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            selectedPackages: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  packageId: { type: Type.STRING },
                  priority: { type: Type.STRING },
                  badge: { type: Type.STRING },
                  clinicalReason: { type: Type.STRING },
                  sourceType: { type: Type.STRING },
                },
                required: ['packageId', 'priority', 'badge', 'clinicalReason'],
              },
            },
          },
          required: ['selectedPackages'],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    const selections = Array.isArray(parsed.selectedPackages) ? parsed.selectedPackages : [];

    const result: RecommendedPackageItemDto[] = [];
    for (const sel of selections) {
      const match = context.candidates.find((c) => c.id === sel.packageId);
      if (match && !result.some((r) => r.packageId === match.id)) {
        let finalSourceType: 'DROP_OFF' | 'SEARCH_INTENT' | 'RECENT_VIEW' | 'PROFILE_AI' | 'POPULAR' = 'PROFILE_AI';
        if (['DROP_OFF', 'SEARCH_INTENT', 'RECENT_VIEW', 'PROFILE_AI', 'POPULAR'].includes(sel.sourceType)) {
          finalSourceType = sel.sourceType;
        } else if (match.behaviorSourceType) {
          finalSourceType = match.behaviorSourceType as any;
        } else if (match.origin === 'PROFILE') {
          finalSourceType = 'PROFILE_AI';
        } else {
          finalSourceType = 'POPULAR';
        }

        result.push({
          packageId: match.id,
          code: match.code,
          slug: match.slug || undefined,
          name: match.name,
          price: match.price,
          durationMin: match.durationMin,
          specialtyId: match.specialtyId,
          specialtyName: match.specialtyName,
          priority: ['HIGH', 'MEDIUM', 'LOW'].includes(sel.priority) ? sel.priority : 'MEDIUM',
          badge: sel.badge || (finalSourceType === 'SEARCH_INTENT' ? 'Phù hợp tìm kiếm' : 'Đề xuất chuyên khoa'),
          clinicalReason: sel.clinicalReason || 'Phù hợp với nhu cầu tầm soát và thể trạng sức khỏe.',
          sourceType: finalSourceType,
        });
      }
    }

    return result;
  }

  private evaluateHybridWithHeuristics(
    candidatePool: Array<{ pkg: any; origin: string; behaviorSourceType?: string; isFollowUp?: boolean }>,
    profile: any,
    medicalHistory: string,
  ): RecommendedPackageItemDto[] {
    const list: RecommendedPackageItemDto[] = [];
    const usedIds = new Set<string>();

    for (const item of candidatePool) {
      if (usedIds.has(item.pkg.id)) continue;
      usedIds.add(item.pkg.id);

      let priority: RecommendationPriority = 'MEDIUM';
      let badge = 'Đề xuất y khoa';
      let reason = 'Gói khám tiêu biểu được hội đồng y khoa VitaCare khuyến nghị thực hiện.';
      let sourceType: 'DROP_OFF' | 'SEARCH_INTENT' | 'RECENT_VIEW' | 'PROFILE_AI' | 'POPULAR' = 'POPULAR';

      if (item.isFollowUp) {
        priority = 'HIGH';
        badge = 'Tái khám theo hẹn';
        reason = 'Khuyến nghị tái khám định kỳ để đánh giá đáp ứng điều trị.';
        sourceType = 'PROFILE_AI';
      } else if (item.origin === 'BEHAVIOR') {
        if (item.behaviorSourceType === 'DROP_OFF') {
          priority = 'HIGH';
          badge = 'Tiếp tục đăng ký';
          reason = 'Gói khám bạn đang quan tâm đặt lịch gần đây.';
          sourceType = 'DROP_OFF';
        } else if (item.behaviorSourceType === 'SEARCH_INTENT') {
          priority = 'HIGH';
          badge = 'Phù hợp tìm kiếm';
          reason = 'Gói khám tương ứng với triệu chứng bạn vừa tìm kiếm.';
          sourceType = 'SEARCH_INTENT';
        } else {
          priority = 'MEDIUM';
          badge = 'Quan tâm gần đây';
          reason = 'Dựa trên mối quan tâm chuyên khoa gần đây của bạn.';
          sourceType = 'RECENT_VIEW';
        }
      } else if (item.origin === 'PROFILE') {
        priority = list.length === 0 ? 'HIGH' : 'MEDIUM';
        badge = 'Khám sàng lọc ban đầu';
        reason = medicalHistory
          ? `Phù hợp tiền sử: ${medicalHistory} · Khuyến nghị tầm soát chuyên sâu.`
          : 'Khuyến nghị tầm soát và đánh giá sức khỏe chuyên khoa định kỳ.';
        sourceType = 'PROFILE_AI';
      }

      list.push({
        packageId: item.pkg.id,
        code: item.pkg.code,
        slug: item.pkg.slug || undefined,
        name: item.pkg.name,
        price: Number(item.pkg.price),
        durationMin: item.pkg.durationMin,
        specialtyId: item.pkg.specialtyId,
        specialtyName: item.pkg.specialty?.name || 'Đa khoa',
        priority,
        badge,
        clinicalReason: reason,
        sourceType,
      });

      if (list.length >= 6) break;
    }

    return list;
  }

  private async getBehaviorTelemetryContext(
    userId?: string,
    sessionId?: string,
  ): Promise<{
    topSpecialties: Array<{ specialtyId: number; specialtyName: string; score: number }>;
    lastSearchQuery?: string;
    dropOffPkgId?: string;
  }> {
    if (!this.redis.isEnabled() || (!userId && !sessionId)) {
      return { topSpecialties: [] };
    }

    const keys: string[] = [];
    if (userId) keys.push(`rec:user_interest:${userId}`);
    if (sessionId) keys.push(`rec:guest_interest:${sessionId}`);

    const specialtyScoreMap = new Map<number, number>();
    let lastSearchQuery: string | undefined;
    let dropOffPkgId: string | undefined;

    for (const key of keys) {
      try {
        const hashData = (await this.redis.hgetall(key)) as Record<string, string> | null;
        if (!hashData || typeof hashData !== 'object') continue;

        for (const [field, val] of Object.entries(hashData)) {
          if (field.startsWith('specialty:')) {
            const specId = parseInt(field.replace('specialty:', ''), 10);
            const score = parseInt(String(val), 10) || 0;
            if (!isNaN(specId) && score > 0) {
              specialtyScoreMap.set(specId, Math.max(specialtyScoreMap.get(specId) || 0, score));
            }
          } else if (field === 'last_search_query' && val) {
            lastSearchQuery = String(val);
          } else if (field === 'drop_off_pkg' && val) {
            dropOffPkgId = String(val);
          }
        }
      } catch {}
    }

    const topSpecialties: Array<{ specialtyId: number; specialtyName: string; score: number }> = [];
    if (specialtyScoreMap.size > 0) {
      const specIds = Array.from(specialtyScoreMap.keys());
      const specialtiesDb = await this.prisma.specialty.findMany({
        where: { id: { in: specIds } },
        select: { id: true, name: true },
      });

      for (const spec of specialtiesDb) {
        topSpecialties.push({
          specialtyId: spec.id,
          specialtyName: spec.name,
          score: specialtyScoreMap.get(spec.id) || 0,
        });
      }
      topSpecialties.sort((a, b) => b.score - a.score);
    }

    return { topSpecialties, lastSearchQuery, dropOffPkgId };
  }

  private isPackageAppropriateForGender(name: string, description: string, gender: string): boolean {
    const text = `${name} ${description}`.toLowerCase();
    const g = (gender || '').toUpperCase();
    if (g === 'MALE') {
      const femaleKeywords = ['phụ khoa', 'thai sản', 'cổ tử cung', 'buồng trứng', 'mang thai', 'tiền hôn nhân nữ', 'ung thư vú', 'khám thai', 'sinh sản nữ', 'nữ giới'];
      if (femaleKeywords.some((kw) => text.includes(kw))) return false;
    } else if (g === 'FEMALE') {
      const maleKeywords = ['nam khoa', 'tuyến tiền liệt', 'sinh sản nam', 'tiền hôn nhân nam', 'sức khỏe nam giới', 'nam giới'];
      if (maleKeywords.some((kw) => text.includes(kw))) return false;
    }
    return true;
  }

  private isPackageAppropriateForAge(name: string, description: string, age: number): boolean {
    const text = `${name} ${description}`.toLowerCase();
    if (age >= 18) {
      const pediatricsKeywords = ['nhi khoa', 'sơ sinh', 'trẻ em', 'tiêm chủng trẻ em'];
      if (pediatricsKeywords.some((kw) => text.includes(kw))) return false;
    } else if (age < 16) {
      const adultKeywords = ['lão khoa', 'tiền mãn kinh', 'mãn kinh', 'tuyến tiền liệt', 'tiền hôn nhân'];
      if (adultKeywords.some((kw) => text.includes(kw))) return false;
    }
    return true;
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

  private buildCacheKey(profileId: string): string {
    return `rec:profile:${profileId}`;
  }
}
