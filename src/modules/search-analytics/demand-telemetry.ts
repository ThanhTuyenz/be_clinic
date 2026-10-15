import { AppointmentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';

export const SUCCESSFUL_BOOKING_STATUSES: AppointmentStatus[] = ['BOOKED', 'CONFIRMED', 'CHECKED_IN', 'IN_EXAMINATION', 'COMPLETED', 'NO_SHOW'];
export const conversionPercent = (converted: number, total: number): number | null => total > 0 ? +(converted * 100 / total).toFixed(1) : null;

/** All conversions belong to the same view/search cohort; unrelated bookings never inflate CVR. */
export async function demandTelemetry(prisma: PrismaService, start: Date, end: Date, branchId?: string | { in: string[] }) {
  const period = { gte: start, lt: end };
  const scope = branchId ? { branchId } : {};
  const searchWhere: Prisma.SearchRequestWhereInput = { createdAt: period, ...scope };
  const viewWhere: Prisma.AnalyticsInteractionWhereInput = { eventType: 'PACKAGE_VIEW', occurredAt: period, ...scope };
  const booked: Prisma.AppointmentWhereInput = { status: { in: SUCCESSFUL_BOOKING_STATUSES }, ...scope };
  const paid: Prisma.AppointmentWhereInput = { ...booked, OR: [{ invoice: { status: 'PAID' } }, { bookingOrder: { invoice: { status: 'PAID' } } }] };
  const [queries, emptyQueries, statuses, viewGroups, convertedViews, clicked, convertedSearches, paidSearches, firstSearch, firstView] = await Promise.all([
    prisma.searchRequest.groupBy({ by: ['normalizedQuery'], where: { ...searchWhere, status: { in: ['SUCCESS', 'EMPTY'] } }, _count: { _all: true }, _min: { query: true }, orderBy: [{ _count: { normalizedQuery: 'desc' } }, { normalizedQuery: 'asc' }], take: 8 }),
    prisma.searchRequest.groupBy({ by: ['normalizedQuery'], where: { ...searchWhere, status: 'EMPTY' }, _count: { _all: true }, _min: { query: true }, orderBy: [{ _count: { normalizedQuery: 'desc' } }, { normalizedQuery: 'asc' }], take: 6 }),
    prisma.searchRequest.groupBy({ by: ['status'], where: searchWhere, _count: { _all: true }, _avg: { latencyMs: true } }),
    prisma.analyticsInteraction.groupBy({ by: ['targetId'], where: viewWhere, _count: { _all: true } }),
    prisma.appointment.findMany({ where: { ...booked, sourceView: viewWhere }, distinct: ['sourceViewId'], select: { sourceViewId: true, sourceView: { select: { targetId: true } } } }),
    prisma.analyticsInteraction.findMany({ where: { eventType: 'RESULT_CLICK', search: searchWhere }, distinct: ['searchId'], select: { searchId: true } }),
    prisma.appointment.findMany({ where: { ...booked, search: searchWhere }, distinct: ['searchId'], select: { searchId: true } }),
    prisma.appointment.findMany({ where: { ...paid, search: searchWhere }, distinct: ['searchId'], select: { searchId: true } }),
    prisma.searchRequest.findFirst({ where: scope, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    prisma.analyticsInteraction.findFirst({ where: { eventType: 'PACKAGE_VIEW', ...scope }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
  ]);
  const counts = new Map(statuses.map(item => [item.status, item._count._all]));
  const executed = statuses.reduce((sum, item) => sum + item._count._all, 0);
  const eligibleSearches = (counts.get('SUCCESS') || 0) + (counts.get('EMPTY') || 0);
  const views = new Map(viewGroups.map(item => [item.targetId, item._count._all]));
  const converted = new Map<string, number>();
  for (const item of convertedViews) if (item.sourceView) converted.set(item.sourceView.targetId, (converted.get(item.sourceView.targetId) || 0) + 1);
  const totalViews = [...views.values()].reduce((sum, count) => sum + count, 0);
  return {
    views, converted, totalViews, convertedViewCount: convertedViews.length,
    topSearches: queries.map(row => ({ query: row._min.query || row.normalizedQuery, searchCount: row._count._all })),
    unmatchedSearches: emptyQueries.map(row => ({ query: row._min.query || row.normalizedQuery, searchCount: row._count._all })),
    trackingStartedAt: [firstSearch?.createdAt, firstView?.createdAt].filter((value): value is Date => !!value).sort((a, b) => +a - +b)[0] || null,
    searchFunnel: {
      executed, eligibleSearches, withResults: counts.get('SUCCESS') || 0, empty: counts.get('EMPTY') || 0,
      errors: counts.get('ERROR') || 0, partial: counts.get('PARTIAL') || 0,
      clicked: clicked.filter(item => item.searchId).length,
      booked: convertedSearches.filter(item => item.searchId).length, paid: paidSearches.filter(item => item.searchId).length,
      averageLatencyMs: executed ? Math.round(statuses.reduce((sum, item) => sum + (item._avg.latencyMs || 0) * item._count._all, 0) / executed) : null,
    },
  };
}
