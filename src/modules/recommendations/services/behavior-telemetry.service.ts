import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import { RedisService } from '../../../infrastructure/redis/redis.service.js';
import { TrackBehaviorDto, TrackingActionType } from '../recommendation.dto.js';
import { TELEMETRY_CONFIG } from '../constants/recommendation.constants.js';

type BehaviorEvent = Omit<TrackBehaviorDto, 'sessionId'> & { sessionId?: string; searchQuery?: string };

@Injectable()
export class BehaviorTelemetryService {
  private readonly logger = new Logger(BehaviorTelemetryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) { }

  // hành vi người dùng
  async trackUserBehavior(dto: BehaviorEvent, userId?: string): Promise<{ success: boolean }> {
    if (!this.redis.isEnabled()) return { success: true };

    try {
      const resolvedSpecialtyId = await this.resolveSpecialtyId(dto);
      const userKeys = this.getUserTelemetryKeys(dto.sessionId, userId);

      await Promise.allSettled([
        this.recordPersonalInterests(userKeys, dto, resolvedSpecialtyId),
        this.persistDatabaseAnalytics(dto),
      ]);
      await this.invalidateBehaviorRecommendationCache(dto.sessionId, userId);
    } catch (err: any) {
      this.logger.debug(`[Telemetry] Failed to process telemetry: ${err?.message}`);
    }

    return { success: true };
  }

  /** Only a committed, unpaid HOLD cancellation is an abandoned booking. */
  async recordAbandonedBooking(appointmentId: string): Promise<void> {
    if (!this.redis.isEnabled()) return;
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: appointmentId, status: 'CANCELLED', servicePackageId: { not: null },
        statusHistories: { some: { fromStatus: 'HOLD', toStatus: 'CANCELLED', reason: { in: ['PAYMENT_HOLD_TIMEOUT', 'PAYMENT_CANCELLED'] } } },
      },
      select: {
        id: true, bookingOrderId: true, servicePackageId: true,
        patientProfile: { select: { accountId: true } },
        bookingOrder: { select: { accountId: true, invoice: { select: { payments: { where: { paidAt: { not: null } }, select: { id: true }, take: 1 } } } } },
        invoice: { select: { payments: { where: { paidAt: { not: null } }, select: { id: true }, take: 1 } } },
        sourceView: { select: { sessionId: true } },
      },
    });
    if (!appointment?.servicePackageId || appointment.invoice?.payments.length || appointment.bookingOrder?.invoice?.payments.length) return;
    const userId = appointment.bookingOrder?.accountId || appointment.patientProfile.accountId || undefined;
    const sessionId = appointment.sourceView?.sessionId;
    if (!userId && !sessionId) return;
    const key = `rec:dropoff:${appointment.bookingOrderId || appointment.id}:${appointment.servicePackageId}`;
    const recorded = await this.redis.getClient()?.set(key, '1', 'EX', TELEMETRY_CONFIG.BEHAVIOR_TTL_SECONDS, 'NX');
    if (!recorded) return;
    await this.trackUserBehavior({ sessionId,
      actionType: TrackingActionType.DROP_OFF, targetPackageId: appointment.servicePackageId }, userId);
  }

  /**
   * Phân giải chuyên khoa từ targetPackageId nếu client chưa truyền targetSpecialtyId
   */
  private async resolveSpecialtyId(dto: BehaviorEvent): Promise<number | undefined> {
    if (!dto.targetPackageId) return dto.targetSpecialtyId;

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
  private getUserTelemetryKeys(sessionId?: string, userId?: string): string[] {
    // Logged-in accounts never read/write a shared browser's anonymous interests.
    if (userId) return [`rec:user_interest:${userId}`];
    return sessionId ? [`rec:guest_interest:${sessionId}`] : [];
  }

  /**
   * Cập nhật điểm quan tâm chuyên khoa, từ khóa tìm kiếm và gói bỏ dở
   */
  private async recordPersonalInterests(
    userKeys: string[],
    dto: BehaviorEvent,
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
      if (dto.actionType === TrackingActionType.VIEW_PACKAGE && dto.targetPackageId) {
        // One atomic update keeps recency and frequency consistent under concurrent views.
        await client.eval(`local countKey = KEYS[2]
          redis.call('ZADD', KEYS[1], ARGV[1], ARGV[2])
          redis.call('HINCRBY', countKey, ARGV[2], 1)
          local extra = redis.call('ZCARD', KEYS[1]) - tonumber(ARGV[3])
          if extra > 0 then
            local removed = redis.call('ZRANGE', KEYS[1], 0, extra - 1)
            for _, id in ipairs(removed) do redis.call('ZREM', KEYS[1], id); redis.call('HDEL', countKey, id) end
          end
          redis.call('EXPIRE', KEYS[1], ARGV[4]); redis.call('EXPIRE', countKey, ARGV[4]); return 1`,
          2, key + ':package_views', key + ':package_view_counts', eventAt, dto.targetPackageId,
          TELEMETRY_CONFIG.MAX_RECENT_PACKAGE_VIEWS, TELEMETRY_CONFIG.BEHAVIOR_TTL_SECONDS);
      }
      // 2. Lưu từ khóa tìm kiếm gần nhất
      if (dto.actionType === TrackingActionType.SEARCH && dto.searchQuery?.trim()) {
        pipeline.hset(key, 'last_search_query', dto.searchQuery.trim().toLowerCase());
        pipeline.hset(key, 'last_search_at', eventAt);
      }

      // 3. Lưu gói khám bỏ dở ở bước thanh toán
      if (dto.actionType === TrackingActionType.DROP_OFF && dto.targetPackageId) {
        pipeline.hset(key, 'drop_off_pkg', dto.targetPackageId);
        pipeline.hset(key, 'drop_off_at', eventAt);
        pipeline.hset(key, 'drop_off_verified', '1');
      }

      // Gia hạn TTL cho dữ liệu hành vi (14 ngày)
      pipeline.expire(key, TELEMETRY_CONFIG.BEHAVIOR_TTL_SECONDS);
      await pipeline.exec();
    }
  }

  /**
   * Ghi log thống kê tìm kiếm và cập nhật lượt xem gói vào cơ sở dữ liệu PostgreSQL
   */
  private async persistDatabaseAnalytics(dto: BehaviorEvent): Promise<void> {
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

  }

  /**
   * Xóa cache hành vi, giữ nguyên cache hồ sơ khi người dùng vừa có hành vi mới để phản ánh tức thời
   */
  async invalidateBehaviorRecommendationCache(sessionId?: string, userId?: string): Promise<void> {
    try {
      const deletePromises: Promise<any>[] = [];
      if (userId) {
        deletePromises.push(this.redis.delete(`${TELEMETRY_CONFIG.CACHE_PREFIX}:behavior:u:${userId}`));
      }
      if (sessionId && !userId) {
        deletePromises.push(this.redis.delete(`${TELEMETRY_CONFIG.CACHE_PREFIX}:behavior:sess:${sessionId}`));
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
    recentViews?: Array<{ packageId: string; viewCount: number; lastViewedAt: number }>;
  }> {
    if (!this.redis.isEnabled() || (!userId && !sessionId)) {
      return { topSpecialties: [], recentViews: [] };
    }

    const keys = this.getUserTelemetryKeys(sessionId, userId);
    const recentViews: Array<{ packageId: string; viewCount: number; lastViewedAt: number }> = [];

    const specialtyScoreMap = new Map<number, number>();
    let lastSearchQuery: string | undefined;
    let dropOffPkgId: string | undefined;
    let lastSearchAt = 0;
    let dropOffAt = 0;

    for (const key of keys) {
      try {
        const client = this.redis.getClient();
        const [viewed, counts] = await Promise.all([
          client.zrevrange(key + ':package_views', 0, TELEMETRY_CONFIG.MAX_RECENT_PACKAGE_VIEWS - 1, 'WITHSCORES'),
          client.hgetall(key + ':package_view_counts'),
        ]);
        for (let index = 0; index < viewed.length; index += 2) {
          const lastViewedAt = Number(viewed[index + 1]);
          if (Number.isFinite(lastViewedAt) && lastViewedAt >= Date.now() - TELEMETRY_CONFIG.BEHAVIOR_TTL_SECONDS * 1000) {
            recentViews.push({ packageId: viewed[index], viewCount: Math.max(1, Number(counts[viewed[index]]) || 1), lastViewedAt });
          }
        }
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
          } else if (field === 'drop_off_pkg' && val && hashData.drop_off_verified === '1') {
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

    return { topSpecialties, lastSearchQuery, dropOffPkgId, recentViews };
  }
}
