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
      // 1. Tăng điểm chuyên khoa quan tâm (capped at MAX_SPECIALTY_SCORE_CAP)
      if (specialtyId && scoreToAdd > 0) {
        const field = `specialty:${specialtyId}`;
        await client.eval(
          'local current = tonumber(redis.call("HGET", KEYS[1], ARGV[1]) or "0"); local next = math.min(current + tonumber(ARGV[2]), tonumber(ARGV[3])); redis.call("HSET", KEYS[1], ARGV[1], next); return next;',
          1,
          key,
          field,
          scoreToAdd,
          TELEMETRY_CONFIG.MAX_SPECIALTY_SCORE_CAP,
        );
      }

      const pipeline = client.pipeline();
      const eventAt = Date.now().toString();
      // 2. Lưu từ khóa tìm kiếm gần nhất
      if (dto.actionType === TrackingActionType.SEARCH && dto.searchQuery?.trim()) {
        pipeline.hset(key, 'last_search_query', dto.searchQuery.trim().toLowerCase());
        pipeline.hset(key, 'last_search_at', eventAt);
      }

      // 3. Lưu gói khám bỏ dở ở bước thanh toán
      if (dto.actionType === TrackingActionType.DROP_OFF && dto.targetPackageId) {
        pipeline.hset(key, 'drop_off_pkg', dto.targetPackageId);
        pipeline.hset(key, 'drop_off_at', eventAt);
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
      pipeline.zincrby('rec:global:package_views', 1, dto.targetPackageId);
      pipeline.zincrby('rec:global:popular_packages', 1, dto.targetPackageId);
    }
    if (dto.actionType === TrackingActionType.SEARCH && dto.searchQuery?.trim()) {
      const q = dto.searchQuery.trim().toLowerCase();
      const dateKey = new Date().toISOString().slice(0, 10);
      const dailyKey = `rec:global:search_queries:${dateKey}`;
      pipeline.zincrby(dailyKey, 1, q);
      pipeline.expire(dailyKey, 172800);
      pipeline.zincrby('rec:global:search_queries', 1, q);
    }

    await pipeline.exec();
  }

  /**
   * Ghi log thống kê tìm kiếm và cập nhật lượt xem gói vào cơ sở dữ liệu PostgreSQL
   */
  private async persistDatabaseAnalytics(dto: TrackBehaviorDto): Promise<void> {
    // 1. Cập nhật lượt xem gói khám
    if (dto.actionType === TrackingActionType.VIEW_PACKAGE && dto.targetPackageId) {
      try {
        await this.prisma.servicePackage.update({
          where: { id: dto.targetPackageId },
          data: { viewCount: { increment: 1 } },
        });
      } catch (err: any) {
        this.logger.debug(`[Telemetry] Failed to increment package viewCount: ${err?.message}`);
      }
    }

    // 2. Ghi log tìm kiếm
    if (dto.actionType === TrackingActionType.SEARCH && dto.searchQuery?.trim()) {
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
        this.logger.debug(`[Telemetry] Failed to persist DB search log: ${err?.message}`);
      }
    }
  }

  /**
   * Xóa Cache gợi ý trang chủ khi người dùng vừa có hành vi mới để phản ánh tức thời
   */
  async invalidateHomeRecommendationCache(sessionId?: string, userId?: string): Promise<void> {
    try {
      const deletePromises: Promise<any>[] = [];
      if (userId) {
        deletePromises.push(this.redis.deletePattern(`rec:v2:home:u:${userId}:*`));
      }
      if (sessionId) {
        deletePromises.push(this.redis.deletePattern(`rec:v2:home:sess:${sessionId}*`));
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
    let lastSearchAt = 0;
    let dropOffAt = 0;

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
            const eventAt = Number(hashData.last_search_at || 0);
            if (eventAt >= lastSearchAt) {
              lastSearchAt = eventAt;
              lastSearchQuery = String(val);
            }
          } else if (field === 'drop_off_pkg' && val) {
            const eventAt = Number(hashData.drop_off_at || 0);
            if (eventAt >= dropOffAt) {
              dropOffAt = eventAt;
              dropOffPkgId = String(val);
            }
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
