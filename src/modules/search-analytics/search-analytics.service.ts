import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { AnalyticsInteractionDto } from './search-analytics.dto.js';
import { randomUUID } from 'node:crypto';
import { normalizeSearch, parseSearchIntent } from '../../common/utils/search-query.js';
import { vietnamDateKey } from './analytics-time.js';

@Injectable()
export class SearchAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

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
    const { occurredAt: rawTime, ...data } = dto;
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
        id: source.sourceViewId, ...owner, eventType: 'PACKAGE_VIEW', targetId: target.packageId,
        occurredAt: { gte: since }, OR: [{ branchId: null }, { branchId: target.branchId }],
      }, select: { id: true } });
      if (view) sourceViewId = view.id;
    }
    return { searchId, sourceViewId };
  }
}
