import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import { RedisService } from '../../../infrastructure/redis/redis.service.js';
import { TrackBehaviorDto, TrackingActionType } from '../recommendation.dto.js';
import { TELEMETRY_CONFIG } from '../constants/recommendation.constants.js';

export type BehaviorEvent = Omit<TrackBehaviorDto, 'sessionId'> & { sessionId?: string; searchQuery?: string; searchPackageIds?: number[]; abandonedAt?: number };
type RecentSearch = { query: string; searchedAt: number; packageIds?: number[] };
type RecentView = { packageId: number; viewCount: number; lastViewedAt: number };
type RecentDropOff = { packageId: number; abandonedAt: number };
interface BehaviorTelemetryContext {
  recentSearches: RecentSearch[];
  recentViews: RecentView[];
  recentDropOffs: RecentDropOff[];
}

@Injectable()
export class BehaviorTelemetryService {
  private readonly logger = new Logger(BehaviorTelemetryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) { }

  // hành vi người dùng
  async trackUserBehavior(dto: BehaviorEvent, userId?: string): Promise<{ success: boolean; recorded?: boolean }> {
    if (!this.redis.isEnabled()) return { success: true };

    try {
      const key = this.getUserTelemetryKey(dto.sessionId, userId);

      const [recorded] = await Promise.allSettled([
        this.recordBehaviorHistory(key, dto),
        this.incrementPackageViewCount(dto),
      ]);
      return { success: true, recorded: recorded.status === 'fulfilled' };
    } catch (err: any) {
      this.logger.debug(`[Telemetry] Failed to process telemetry: ${err?.message}`);
    }

    return { success: true };
  }

  /** Only a committed, unpaid HOLD cancellation is an abandoned booking. */
  async recordAbandonedBooking(appointmentId: string): Promise<{ userId?: string; packageId: number } | undefined> {
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
        statusHistories: {
          where: { fromStatus: 'HOLD', toStatus: 'CANCELLED', reason: { in: ['PAYMENT_HOLD_TIMEOUT', 'PAYMENT_CANCELLED'] } },
          orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true },
        },
      },
    });
    if (!appointment?.servicePackageId || appointment.bookingOrder.invoice?.payments.length) return;
    const userId = appointment.bookingOrder?.accountId || appointment.patientProfile.accountId || undefined;
    if (!userId) return;
    const key = `rec:dropoff:${appointment.bookingOrderId || appointment.id}:${appointment.servicePackageId}`;
    const recorded = await this.redis.getClient()?.set(key, '1', 'EX', TELEMETRY_CONFIG.BEHAVIOR_TTL_SECONDS, 'NX');
    if (!recorded) return;
    const recordedBehavior = await this.trackUserBehavior({
      actionType: TrackingActionType.DROP_OFF, targetPackageId: appointment.servicePackageId,
      abandonedAt: appointment.statusHistories[0]?.createdAt.getTime(),
    }, userId);
    if (!recordedBehavior.recorded) return;
    return { userId, packageId: appointment.servicePackageId };
  }

  /**
   * Chọn Redis key của tài khoản hoặc khách.
   */
  private getUserTelemetryKey(sessionId?: string, userId?: string): string | undefined {
    // Logged-in accounts never read/write a shared browser's anonymous interests.
    if (userId) return `rec:user_interest:${userId}`;
    return sessionId ? `rec:guest_interest:${sessionId}` : undefined;
  }

  /**
   * Lưu lịch sử xem gói, tìm kiếm và bỏ dở.
   */
  private async recordBehaviorHistory(
    key: string | undefined,
    dto: BehaviorEvent,
  ): Promise<void> {
    const client = this.redis.getClient();
    if (!client || !key) return;

    const eventAt = (dto.actionType === TrackingActionType.DROP_OFF ? dto.abandonedAt ?? Date.now() : Date.now()).toString();
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
    // 2. Keep distinct searches atomically; repeating a query refreshes its timestamp.
    if (dto.actionType === TrackingActionType.SEARCH && dto.searchQuery?.trim()) {
      const query = dto.searchQuery.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
      await client.eval(`
          local legacy = redis.call('HGET', KEYS[1], 'last_search_query')
          local legacyAt = tonumber(redis.call('HGET', KEYS[1], 'last_search_at') or '0')
          if legacy and legacyAt >= tonumber(ARGV[1]) - tonumber(ARGV[4]) * 1000 then
            redis.call('ZADD', KEYS[2], 'NX', legacyAt, legacy)
          end
          redis.call('ZADD', KEYS[2], ARGV[1], ARGV[2])
          redis.call('HSET', KEYS[3], ARGV[2], ARGV[5])
          redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', '(' .. (tonumber(ARGV[1]) - tonumber(ARGV[4]) * 1000))
          local extra = redis.call('ZCARD', KEYS[2]) - tonumber(ARGV[3])
          if extra > 0 then redis.call('ZREMRANGEBYRANK', KEYS[2], 0, extra - 1) end
          for _, query in ipairs(redis.call('HKEYS', KEYS[3])) do
            if not redis.call('ZSCORE', KEYS[2], query) then redis.call('HDEL', KEYS[3], query) end
          end
          redis.call('EXPIRE', KEYS[2], ARGV[4])
          redis.call('EXPIRE', KEYS[3], ARGV[4])
          return 1`,
        3, key, key + ':searches', key + ':search_results', eventAt, query,
        TELEMETRY_CONFIG.MAX_RECENT_SEARCHES, TELEMETRY_CONFIG.BEHAVIOR_TTL_SECONDS,
        JSON.stringify([...new Set(dto.searchPackageIds || [])].slice(0, TELEMETRY_CONFIG.SEMANTIC_SEARCH_LIMIT)));
    }

    // 3. Lưu gói khám bỏ dở ở bước thanh toán
    if (dto.actionType === TrackingActionType.DROP_OFF && dto.targetPackageId) {
      await client.eval(`
        local legacy = redis.call('HGET', KEYS[1], 'drop_off_pkg')
        local legacyAt = tonumber(redis.call('HGET', KEYS[1], 'drop_off_at') or '0')
        if legacy and redis.call('HGET', KEYS[1], 'drop_off_verified') == '1'
          and legacyAt >= tonumber(ARGV[1]) - tonumber(ARGV[4]) * 1000 then
          redis.call('ZADD', KEYS[2], 'NX', legacyAt, legacy)
        end
        local current = tonumber(redis.call('ZSCORE', KEYS[2], ARGV[2]) or '0')
        if tonumber(ARGV[1]) > current then redis.call('ZADD', KEYS[2], ARGV[1], ARGV[2]) end
        redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', '(' .. (tonumber(ARGV[1]) - tonumber(ARGV[4]) * 1000))
        local extra = redis.call('ZCARD', KEYS[2]) - tonumber(ARGV[3])
        if extra > 0 then redis.call('ZREMRANGEBYRANK', KEYS[2], 0, extra - 1) end
        redis.call('EXPIRE', KEYS[2], ARGV[4])
        return 1`,
        2, key, key + ':drop_offs', eventAt, dto.targetPackageId,
        TELEMETRY_CONFIG.MAX_RECENT_DROP_OFFS, TELEMETRY_CONFIG.BEHAVIOR_TTL_SECONDS);
    }

    // Gia hạn TTL cho dữ liệu hành vi (14 ngày)
    await client.expire(key, TELEMETRY_CONFIG.BEHAVIOR_TTL_SECONDS);
  }

  private async incrementPackageViewCount(dto: BehaviorEvent): Promise<void> {
    if (dto.actionType !== TrackingActionType.VIEW_PACKAGE || !dto.targetPackageId) return;
    try {
      await this.prisma.servicePackage.update({
        where: { id: dto.targetPackageId },
        data: { viewCount: { increment: 1 } },
      });
    } catch (err: any) {
      this.logger.debug(`[Telemetry] Failed to increment package viewCount: ${err?.message}`);
    }
  }

  /**
   * Đọc ba nguồn hành vi: đã xem, tìm kiếm và bỏ dở.
   */
  async getBehaviorTelemetryContext(
    userId?: string,
    sessionId?: string,
  ): Promise<BehaviorTelemetryContext> {
    const key = this.getUserTelemetryKey(sessionId, userId);
    if (!this.redis.isEnabled() || !key) {
      return { recentViews: [], recentSearches: [], recentDropOffs: [] };
    }
    const client = this.redis.getClient();
    if (!client) return { recentViews: [], recentSearches: [], recentDropOffs: [] };

    const read = async <T>(source: string, load: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await load();
      } catch {
        this.logger.debug(`[Telemetry] Unable to read ${source}; skipping this signal.`);
        return fallback;
      }
    };
    const recentViews: RecentView[] = [];

    const searches = new Map<string, number>();
    const dropOffs = new Map<number, number>();
    const now = Date.now();
    const cutoff = now - TELEMETRY_CONFIG.BEHAVIOR_TTL_SECONDS * 1000;
    const isRecent = (at: number) => Number.isSafeInteger(at) && at >= cutoff && at <= now;
    const addSearch = (raw: string, searchedAt: number) => {
      const query = raw.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
      if (query && isRecent(searchedAt)) {
        searches.set(query, Math.max(searches.get(query) || 0, searchedAt));
      }
    };
    const addDropOff = (packageId: number, abandonedAt: number) => {
      if (Number.isInteger(packageId) && packageId > 0 && isRecent(abandonedAt)) {
        dropOffs.set(packageId, Math.max(dropOffs.get(packageId) || 0, abandonedAt));
      }
    };

    // Each read falls back independently, so a broken key does not discard other signals.
    const [viewed, counts, recentQueries, abandoned, hashData, searchResults] = await Promise.all([
      read('package views', () => client.zrevrange(key + ':package_views', 0, TELEMETRY_CONFIG.MAX_RECENT_PACKAGE_VIEWS - 1, 'WITHSCORES'), []),
      read('view counts', () => client.hgetall(key + ':package_view_counts'), {}),
      read('searches', () => client.zrevrange(key + ':searches', 0, TELEMETRY_CONFIG.MAX_RECENT_SEARCHES - 1, 'WITHSCORES'), []),
      read('drop-offs', () => client.zrevrange(key + ':drop_offs', 0, TELEMETRY_CONFIG.MAX_RECENT_DROP_OFFS - 1, 'WITHSCORES'), []),
      read('legacy history', () => client.hgetall(key), {}),
      read('search results', () => client.hgetall(key + ':search_results'), {}),
    ]);
    for (let index = 0; index < abandoned.length; index += 2) {
      addDropOff(Number(abandoned[index]), Number(abandoned[index + 1]));
    }
    for (let index = 0; index < recentQueries.length; index += 2) {
      addSearch(recentQueries[index], Number(recentQueries[index + 1]));
    }
    for (let index = 0; index < viewed.length; index += 2) {
      const lastViewedAt = Number(viewed[index + 1]);
      if (Number.isInteger(Number(viewed[index])) && Number(viewed[index]) > 0 && isRecent(lastViewedAt)) {
        const count = Number(counts[viewed[index]]);
        recentViews.push({ packageId: Number(viewed[index]), viewCount: Number.isSafeInteger(count) && count > 0 ? count : 1, lastViewedAt });
      }
    }
    // Read legacy data during migration; new events only write sorted sets.
    if (hashData.last_search_query) {
      addSearch(hashData.last_search_query, Number(hashData.last_search_at || 0));
    }
    if (hashData.drop_off_verified === '1' && hashData.drop_off_pkg) {
      addDropOff(Number(hashData.drop_off_pkg), Number(hashData.drop_off_at || 0));
    }

    const recentSearches = [...searches].map(([query, searchedAt]) => {
      let packageIds: number[] = [];
      try {
        const parsed: unknown = JSON.parse(searchResults[query] || '[]');
        if (Array.isArray(parsed)) packageIds = parsed.map(Number).filter((id) => Number.isInteger(id) && id > 0)
          .slice(0, TELEMETRY_CONFIG.SEMANTIC_SEARCH_LIMIT);
      } catch { /* Ignore malformed or legacy result snapshots. */ }
      return { query, searchedAt, ...(searchResults[query] ? { packageIds } : {}) };
    })
      .sort((a, b) => b.searchedAt - a.searchedAt || a.query.localeCompare(b.query))
      .slice(0, TELEMETRY_CONFIG.MAX_RECENT_SEARCHES);
    const recentDropOffs = [...dropOffs].map(([packageId, abandonedAt]) => ({ packageId, abandonedAt }))
      .sort((a, b) => b.abandonedAt - a.abandonedAt || a.packageId - b.packageId)
      .slice(0, TELEMETRY_CONFIG.MAX_RECENT_DROP_OFFS);
    const qualifiedDropOffs = await read('rebooked drop-offs', () => this.excludeRebookedDropOffs(recentDropOffs, userId, sessionId), []);
    return { recentViews, recentSearches, recentDropOffs: qualifiedDropOffs };
  }

  private async excludeRebookedDropOffs(dropOffs: RecentDropOff[], userId?: string, _sessionId?: string): Promise<RecentDropOff[]> {
    if (!dropOffs.length || !userId) return dropOffs;
    const since = new Date(Math.min(...dropOffs.map(item => item.abandonedAt)));
    const successfulStatuses = ['CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW'] as const;
    const confirmationStatuses = ['CONFIRMED'] as const;
    // One account-scoped query; confirmation time also handles holds created before abandonment.
    const bookings = await this.prisma.appointment.findMany({
      where: {
        servicePackageId: { in: dropOffs.map(item => item.packageId) },
        status: { in: [...successfulStatuses] },
        AND: [
          { OR: [{ patientProfile: { accountId: userId } }, { bookingOrder: { accountId: userId } }] },
          { OR: [
            { createdAt: { gte: since } },
            { statusHistories: { some: { toStatus: { in: [...confirmationStatuses] }, createdAt: { gte: since } } } },
          ] },
        ],
      },
      select: { servicePackageId: true, createdAt: true, statusHistories: {
        where: { toStatus: { in: [...confirmationStatuses] }, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true },
      } },
    });
    const confirmedAt = new Map<number, number>();
    for (const booking of bookings) {
      const at = Math.max(booking.createdAt.getTime(), booking.statusHistories[0]?.createdAt.getTime() || 0);
      if (booking.servicePackageId) {
        confirmedAt.set(booking.servicePackageId, Math.max(confirmedAt.get(booking.servicePackageId) || 0, at));
      }
    }
    return dropOffs.filter(item => (confirmedAt.get(item.packageId) || 0) < item.abandonedAt);
  }
}
