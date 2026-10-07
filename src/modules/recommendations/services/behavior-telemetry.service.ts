import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import { RedisService } from '../../../infrastructure/redis/redis.service.js';
import { TrackBehaviorDto, TrackingActionType } from '../recommendation.dto.js';
import { TELEMETRY_CONFIG } from '../constants/recommendation.constants.js';

@Injectable()
export class BehaviorTelemetryService {
  private readonly logger = new Logger(BehaviorTelemetryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) { }

  // hành vi người dùng
  async trackUserBehavior(dto: TrackBehaviorDto, userId?: string): Promise<{ success: boolean }> {
    if (!this.redis.isEnabled()) return { success: true };

    try {
      const resolvedSpecialtyId = await this.resolveSpecialtyId(dto);
      const userKeys = this.getUserTelemetryKeys(dto.sessionId, userId);

      await Promise.allSettled([
        this.recordPersonalInterests(userKeys, dto, resolvedSpecialtyId),
        this.recordGlobalAnalytics(dto, resolvedSpecialtyId),
        this.persistDatabaseAnalytics(dto),
        this.invalidateHomeRecommendationCache(dto.sessionId, userId),
      ]);
    } catch (err: any) {
      this.logger.debug(`[Telemetry] Failed to process telemetry: ${err?.message}`);
    }

    return { success: true };
  }

  /**
   * Phân giải chuyên khoa từ targetPackageId nếu client chưa truyền targetSpecialtyId
   */
  private async resolveSpecialtyId(dto: TrackBehaviorDto): Promise<number | undefined> {
    if (dto.targetSpecialtyId) return dto.targetSpecialtyId;
    if (!dto.targetPackageId) return undefined;

    try {
      const pkg = await this.prisma.servicePackage.findUnique({
        where: { id: dto.targetPackageId },
        select: { specialtyId: true },
      });
      return pkg?.specialtyId ?? undefined;
    } catch (err: any) {
      this.logger.debug(`[Telemetry] Failed to resolve specialty for package ${dto.targetPackageId}: ${err?.message}`);
      return undefined;
    }
  }

  /**
   * Lấy danh sách Redis keys đại diện cho hồ sơ hành vi của người dùng (User / Guest)
   */
  private getUserTelemetryKeys(sessionId: string, userId?: string): string[] {
    const keys = [`rec:guest_interest:${sessionId}`];
    if (userId) {
      keys.push(`rec:user_interest:${userId}`);
    }
    return keys;
  }

  /**
   * Cập nhật điểm quan tâm chuyên khoa, từ khóa tìm kiếm và gói bỏ dở
   */
  private async recordPersonalInterests(
    userKeys: string[],
    dto: TrackBehaviorDto,
    specialtyId?: number,
  ): Promise<void> {
    const scoreToAdd = TELEMETRY_CONFIG.ACTION_SCORES[dto.actionType] ?? 0;
    const client = this.redis.getClient();
    if (!client) return;

    for (const key of userKeys) {
      const pipeline = client.pipeline();

      // 1. Tăng điểm chuyên khoa quan tâm (capped at MAX_SPECIALTY_SCORE_CAP)
      if (specialtyId && scoreToAdd > 0) {
        const field = `specialty:${specialtyId}`;
        const currentVal = await client.hget(key, field);
        const currentScore = parseInt(currentVal || '0', 10);
        const newScore = Math.min(currentScore + scoreToAdd, TELEMETRY_CONFIG.MAX_SPECIALTY_SCORE_CAP);
        pipeline.hset(key, field, newScore.toString());
      }

      // 2. Lưu từ khóa tìm kiếm gần nhất
      if (dto.actionType === TrackingActionType.SEARCH && dto.searchQuery?.trim()) {
        pipeline.hset(key, 'last_search_query', dto.searchQuery.trim().toLowerCase());
      }

      // 3. Lưu gói khám bỏ dở ở bước thanh toán
      if (dto.actionType === TrackingActionType.DROP_OFF && dto.targetPackageId) {
        pipeline.hset(key, 'drop_off_pkg', dto.targetPackageId);
      }

      // Gia hạn TTL cho dữ liệu hành vi (14 ngày)
      pipeline.expire(key, TELEMETRY_CONFIG.BEHAVIOR_TTL_SECONDS);
      await pipeline.exec();
    }
  }

  /**
   * Cập nhật các bảng thống kê tần suất toàn hệ thống (Global Analytics Sorted Sets)
   */
  private async recordGlobalAnalytics(dto: TrackBehaviorDto, specialtyId?: number): Promise<void> {
    const client = this.redis.getClient();
    if (!client) return;

    const pipeline = client.pipeline();

    if (specialtyId) {
      pipeline.zincrby('rec:global:popular_specialties', 1, specialtyId.toString());
    }
    if (dto.targetPackageId) {
      pipeline.zincrby('rec:global:popular_packages', 1, dto.targetPackageId);
    }
    if (dto.actionType === TrackingActionType.SEARCH && dto.searchQuery?.trim()) {
      pipeline.zincrby('rec:global:search_queries', 1, dto.searchQuery.trim().toLowerCase());
    }

    await pipeline.exec();
  }

  /**
   * Ghi log thống kê tìm kiếm vào cơ sở dữ liệu PostgreSQL
   */
  private async persistDatabaseAnalytics(dto: TrackBehaviorDto): Promise<void> {
    if (dto.actionType !== TrackingActionType.SEARCH || !dto.searchQuery?.trim()) return;

    try {
      const keyword = dto.searchQuery.trim().toLowerCase();
      if (keyword.length >= 2) {
        const dateKey = new Date().toISOString().slice(0, 10);
        await this.prisma.searchLog.upsert({
          where: {
            keyword_dateKey_hasResults: {
              keyword,
              dateKey,
              hasResults: true,
            },
          },
          update: { count: { increment: 1 } },
          create: {
            keyword,
            dateKey,
            count: 1,
            hasResults: true,
          },
        });
      }
    } catch (err: any) {
      this.logger.debug(`[Telemetry] Failed to persist DB analytics: ${err?.message}`);
    }
  }

  /**
   * Xóa Cache gợi ý trang chủ khi người dùng vừa có hành vi mới để phản ánh tức thời
   */
  async invalidateHomeRecommendationCache(sessionId?: string, userId?: string): Promise<void> {
    try {
      const deletePromises: Promise<any>[] = [];
      if (userId) {
        deletePromises.push(this.redis.deletePattern(`rec:home:u:${userId}:*`));
      }
      if (sessionId) {
        deletePromises.push(this.redis.deletePattern(`rec:home:sess:${sessionId}:*`));
      }
      if (deletePromises.length > 0) {
        await Promise.all(deletePromises);
      }
    } catch (err: any) {
      this.logger.debug(`[Telemetry] Failed to invalidate home rec cache: ${err?.message}`);
    }
  }

  /**
   * Đọc ngữ cảnh hành vi (chuyên khoa quan tâm, từ khóa tìm kiếm, gói bỏ dở) từ Redis
   */
  async getBehaviorTelemetryContext(
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
      } catch { }
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
}
