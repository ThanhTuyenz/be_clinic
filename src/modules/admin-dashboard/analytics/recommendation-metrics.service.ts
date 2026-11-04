import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import { analyticsRange } from '../../analytics/analytics-time.js';
import { SUCCESSFUL_BOOKING_STATUSES, conversionPercent } from './demand-telemetry.js';
import { RecommendationMetricsQueryDto } from './recommendation-metrics.dto.js';

@Injectable()
export class RecommendationMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async recommendationMetrics(query: RecommendationMetricsQueryDto) {
    let start: Date, end: Date;
    try {
      if (query.start || query.end) {
        end = query.end ? new Date(query.end) : new Date();
        start = query.start ? new Date(query.start) : new Date(end.getTime() - 30 * 86400_000);
      } else {
        ({ start, end } = analyticsRange(query));
      }
    } catch {
      throw new BadRequestException('Khoảng ngày báo cáo không hợp lệ.');
    }
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
