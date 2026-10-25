import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { AnalyticsInteractionDto } from './search-analytics.dto.js';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { normalizeSearch, parseSearchIntent } from '../../common/utils/search-query.js';
import { vietnamDateKey } from './analytics-time.js';
import { SUCCESSFUL_BOOKING_STATUSES, conversionPercent } from './demand-telemetry.js';

interface RecommendationReceipt {
  id: string;
  sessionId: string;
  accountId?: string;
  issuedAt: number;
  packages: Array<{ packageId: string; sourceType?: string }>;
}

@Injectable()
export class SearchAnalyticsService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  createRecommendationToken(packages: RecommendationReceipt['packages'], sessionId?: string, accountId?: string) {
    if (!sessionId || !packages.length) return undefined;
    const receipt: RecommendationReceipt = {
      id: randomUUID(), sessionId, accountId, issuedAt: Date.now(),
      packages: packages.map(({ packageId, sourceType }) => ({ packageId, sourceType: sourceType || 'POPULAR' })),
    };
    const payload = Buffer.from(JSON.stringify(receipt)).toString('base64url');
    return payload + '.' + this.signRecommendation(payload).toString('base64url');
  }

  private signRecommendation(payload: string) {
    return createHmac('sha256', this.config.getOrThrow<string>('auth.secret'))
      .update('recommendation-analytics:v1:' + payload).digest();
  }

  private async recordRecommendationInteraction(dto: AnalyticsInteractionDto, accountId?: string) {
    const [payload, signature, extra] = (dto.recommendationToken || '').split('.');
    const expected = this.signRecommendation(payload || '');
    const received = Buffer.from(signature || '', 'base64url');
    if (!payload || extra || expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw new BadRequestException('Nguồn gợi ý không hợp lệ.');
    }
    let receipt: RecommendationReceipt;
    try { receipt = JSON.parse(Buffer.from(payload, 'base64url').toString()); }
    catch { throw new BadRequestException('Nguồn gợi ý không hợp lệ.'); }
    const now = Date.now();
    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date(now);
    const position = receipt.packages.findIndex(item => item.packageId === dto.targetId);
    if (receipt.issuedAt < now - 24 * 3600_000 || receipt.issuedAt > now
      || receipt.sessionId !== dto.sessionId || (receipt.accountId && receipt.accountId !== accountId)
      || !Number.isFinite(+occurredAt) || +occurredAt < receipt.issuedAt - 5000 || +occurredAt > now + 300_000
      || dto.targetType !== 'PACKAGE' || position < 0 || dto.position !== position + 1) {
      throw new BadRequestException('Gợi ý đã hết hạn hoặc không thuộc phiên hiện tại.');
    }
    const eventId = (type: string) => {
      const hex = createHash('sha256').update(`${receipt.id}:${dto.targetId}:${type}`).digest('hex');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    };
    const data = {
      sessionId: receipt.sessionId, accountId, targetType: 'PACKAGE', targetId: dto.targetId,
      recommendationId: receipt.id, recommendationSource: receipt.packages[position].sourceType || 'POPULAR',
      position: position + 1, occurredAt,
    };
    // A fast click also proves visibility. One package contributes once per response, including retries.
    const events = [{ ...data, id: eventId('IMPRESSION'), eventType: 'RECOMMEND_IMPRESSION' }];
    const clickId = eventId('CLICK');
    if (dto.eventType === 'RECOMMEND_CLICK') events.push({ ...data, id: clickId, eventType: 'RECOMMEND_CLICK' });
    await this.prisma.analyticsInteraction.createMany({ data: events, skipDuplicates: true });
    return { success: true, ...(dto.eventType === 'RECOMMEND_CLICK' ? { sourceViewId: clickId } : {}) };
  }

  async recordSearch(query: string, context: { sessionId?: string; accountId?: string }, result: {
    branchId?: string; packages: Array<{ id: string }>; doctors: Array<{ id: string }>; branches: Array<{ id: string }>;
    partial?: boolean;
  } | null, latencyMs: number) {
    const id = randomUUID();
    const status = result ? result.partial ? 'PARTIAL' : result.packages.length + result.doctors.length + result.branches.length ? 'SUCCESS' : 'EMPTY' : 'ERROR';
    await this.prisma.$transaction(async tx => {
      await tx.searchRequest.create({ data: {
        id, sessionId: context.sessionId || `legacy_${id}`, accountId: context.accountId,
        branchId: result?.branchId, query: query.slice(0, 200), normalizedQuery: normalizeSearch(query),
        intent: JSON.parse(JSON.stringify(parseSearchIntent(query))),
        resultKeys: result ? [
          ...result.packages.map(item => `PACKAGE:${item.id}`), ...result.doctors.map(item => `DOCTOR:${item.id}`), ...result.branches.map(item => `BRANCH:${item.id}`),
        ] : [],
        status, packageCount: result?.packages.length || 0, doctorCount: result?.doctors.length || 0,
        branchCount: result?.branches.length || 0, latencyMs: Math.max(0, Math.round(latencyMs)),
      } });
      if (status === 'SUCCESS' || status === 'EMPTY') {
        const keyword = query.trim().toLowerCase();
        const dateKey = vietnamDateKey(new Date());
        const hasResults = status === 'SUCCESS';
        await tx.searchLog.upsert({ where: { keyword_dateKey_hasResults: { keyword, dateKey, hasResults } },
          update: { count: { increment: 1 } }, create: { keyword, dateKey, hasResults, count: 1 } });
      }
    });
    return id;
  }

  async recordInteraction(dto: AnalyticsInteractionDto, accountId?: string) {
    if (dto.eventType === 'RECOMMEND_IMPRESSION' || dto.eventType === 'RECOMMEND_CLICK') {
      return this.recordRecommendationInteraction(dto, accountId);
    }
    const { occurredAt: rawTime, recommendationToken: _token, ...data } = dto;
    const occurredAt = rawTime ? new Date(rawTime) : new Date();
    if (occurredAt.getTime() < Date.now() - 24 * 3600_000 || occurredAt.getTime() > Date.now() + 300_000) throw new BadRequestException('Thời điểm sự kiện không hợp lệ.');
    let branchId = dto.branchId;
    if (dto.searchId) {
      const search = await this.prisma.searchRequest.findFirst({
        where: { id: dto.searchId, sessionId: dto.sessionId, createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
        select: { accountId: true, branchId: true, resultKeys: true },
      });
      const key = `${dto.targetType}:${dto.targetId}`;
      if (!search || (search.accountId && search.accountId !== accountId) ||
        !Array.isArray(search.resultKeys) || !search.resultKeys.includes(key)) {
        throw new BadRequestException('Kết quả tìm kiếm không còn hợp lệ.');
      }
      branchId = dto.eventType === 'RESULT_CLICK' ? search.branchId || branchId : branchId || search.branchId || undefined;
      if (dto.eventType === 'RESULT_CLICK') {
        const group = search.resultKeys.filter(value => typeof value === 'string' && value.startsWith(`${dto.targetType}:`));
        if (dto.position !== group.indexOf(key) + 1) throw new BadRequestException('Vị trí kết quả không hợp lệ.');
      }
    } else if (dto.eventType === 'RESULT_CLICK') {
      throw new BadRequestException('Thiếu mã lần tìm kiếm.');
    }
    if (dto.targetType === 'PACKAGE') {
      const pkg = await this.prisma.servicePackage.findUnique({
        where: { id: dto.targetId },
        select: { id: true, branchBookingMethod: { select: { branchId: true } }, branchBookingMethods: { select: { branchBookingMethod: { select: { branchId: true } } } } },
      });
      if (!pkg) throw new BadRequestException('Không tìm thấy gói khám.');
      const ids = [...new Set([pkg.branchBookingMethod?.branchId, ...pkg.branchBookingMethods.map(link => link.branchBookingMethod.branchId)].filter((id): id is string => !!id))];
      if (branchId && !ids.includes(branchId)) throw new BadRequestException('Gói khám không thuộc cơ sở này.');
      branchId = branchId || (ids.length === 1 ? ids[0] : undefined);
    } else if (dto.eventType === 'PACKAGE_VIEW') {
      throw new BadRequestException('Loại lượt xem không hợp lệ.');
    }
    await this.prisma.analyticsInteraction.createMany({ data: [{ ...data, occurredAt, branchId, accountId }], skipDuplicates: true });
    return { success: true };
  }

  /** Attribution is optional and never creates a conversion from an unrelated/stale event. */
  async attribution(tx: Prisma.TransactionClient, accountId: string, source: {
    analyticsSessionId?: string; searchId?: string; sourceViewId?: string;
  }, target: { branchId: string; packageId?: string | null; doctorId?: string }) {
    const since = new Date(Date.now() - 24 * 3600_000);
    const owner = { sessionId: source.analyticsSessionId || '', AND: [{ OR: [{ accountId: null }, { accountId }] }] };
    let searchId: string | undefined;
    let sourceViewId: string | undefined;
    if (source.searchId && source.analyticsSessionId) {
      const search = await tx.searchRequest.findFirst({ where: { id: source.searchId, ...owner, createdAt: { gte: since } }, select: { id: true } });
      if (search) {
        const click = await tx.analyticsInteraction.findFirst({ where: {
          searchId: search.id, ...owner, eventType: 'RESULT_CLICK',
          OR: [
            ...(target.packageId ? [{ targetType: 'PACKAGE', targetId: target.packageId }] : []),
            ...(target.doctorId ? [{ targetType: 'DOCTOR', targetId: target.doctorId }] : []),
            { targetType: 'BRANCH', targetId: target.branchId },
          ],
        }, select: { id: true } });
        if (click) searchId = search.id;
      }
    }
    if (source.sourceViewId && source.analyticsSessionId && target.packageId) {
      const view = await tx.analyticsInteraction.findFirst({ where: {
        id: source.sourceViewId, ...owner, eventType: { in: ['PACKAGE_VIEW', 'RECOMMEND_CLICK'] }, targetType: 'PACKAGE', targetId: target.packageId,
        occurredAt: { gte: since }, OR: [{ branchId: null }, { branchId: target.branchId }],
      }, select: { id: true } });
      if (view) sourceViewId = view.id;
    }
    return { searchId, sourceViewId };
  }

  async recommendationMetrics(query: { start?: string; end?: string }) {
    const end = query.end ? new Date(query.end) : new Date();
    const start = query.start ? new Date(query.start) : new Date(end.getTime() - 30 * 86400_000);
    if (!Number.isFinite(+start) || !Number.isFinite(+end) || +start >= +end || +end - +start > 90 * 86400_000) {
      throw new BadRequestException('Khoảng thống kê phải lớn hơn 0 và không quá 90 ngày.');
    }
    const rows = await this.prisma.$queryRaw<Array<{
      source: string; packageId: string; packageName: string | null;
      impressions: bigint; clicks: bigint; checkouts: bigint; bookings: bigint; paid: bigint;
    }>>(Prisma.sql`
      SELECT i.recommendation_source AS source, i.target_id AS "packageId", p.name AS "packageName",
        COUNT(DISTINCT i.id) AS impressions,
        COUNT(DISTINCT c.id) AS clicks,
        COUNT(DISTINCT c.id) FILTER (WHERE a.id IS NOT NULL) AS checkouts,
        COUNT(DISTINCT c.id) FILTER (WHERE a.status::text IN (${Prisma.join(SUCCESSFUL_BOOKING_STATUSES)})) AS bookings,
        COUNT(DISTINCT c.id) FILTER (WHERE a.status::text IN (${Prisma.join(SUCCESSFUL_BOOKING_STATUSES)})
          AND (inv.status::text = 'PAID' OR group_inv.status::text = 'PAID')) AS paid
      FROM analytics_interactions i
      LEFT JOIN service_packages p ON p.id = i.target_id
      LEFT JOIN analytics_interactions c ON c.recommendation_id = i.recommendation_id
        AND c.target_id = i.target_id AND c.event_type = 'RECOMMEND_CLICK'
      LEFT JOIN appointments a ON a.source_view_id = c.id AND a.service_package_id = i.target_id
      LEFT JOIN invoices inv ON inv.appointment_id = a.id
      LEFT JOIN invoices group_inv ON group_inv.booking_order_id = a.booking_order_id
      WHERE i.event_type = 'RECOMMEND_IMPRESSION' AND i.occurred_at >= ${start} AND i.occurred_at < ${end}
      GROUP BY i.recommendation_source, i.target_id, p.name ORDER BY i.recommendation_source, i.target_id
    `);
    const rates = (row: { impressions: number; clicks: number; checkouts: number; bookings: number; paid: number }) => ({
      ...row, ctr: conversionPercent(row.clicks, row.impressions),
      bookingRate: conversionPercent(row.bookings, row.impressions),
      clickToBookingRate: conversionPercent(row.bookings, row.clicks),
    });
    const counts = rows.map(row => ({ source: row.source, packageId: row.packageId, packageName: row.packageName,
      impressions: Number(row.impressions), clicks: Number(row.clicks), checkouts: Number(row.checkouts),
      bookings: Number(row.bookings), paid: Number(row.paid),
    }));
    type Counts = Parameters<typeof rates>[0];
    const zero = (): Counts => ({ impressions: 0, clicks: 0, checkouts: 0, bookings: 0, paid: 0 });
    const add = (sum: Counts, row: Counts): Counts => ({
      impressions: sum.impressions + row.impressions, clicks: sum.clicks + row.clicks,
      checkouts: sum.checkouts + row.checkouts, bookings: sum.bookings + row.bookings, paid: sum.paid + row.paid,
    });
    const sources = new Map<string, Counts>(), packages = new Map<string, Counts & { packageName: string | null }>();
    for (const row of counts) {
      sources.set(row.source, add(sources.get(row.source) || zero(), row));
      packages.set(row.packageId, { ...add(packages.get(row.packageId) || zero(), row), packageName: row.packageName });
    }
    const bySource = [...sources].map(([source, values]) => ({ source, ...rates(values) }));
    const byPackage = [...packages].map(([packageId, { packageName, ...values }]) => ({ packageId, packageName, ...rates(values) }))
      .sort((a, b) => b.impressions - a.impressions || a.packageId.localeCompare(b.packageId));
    return { start: start.toISOString(), end: end.toISOString(), attributionWindowHours: 24,
      totals: rates(counts.reduce(add, zero())), bySource, byPackage };
  }
}
