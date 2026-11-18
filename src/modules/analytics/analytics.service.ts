import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { AnalyticsInteractionDto } from './analytics-interaction.dto.js';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { normalizeSearch, parseSearchIntent } from '../../common/utils/search-query.js';
import { vietnamDateKey } from './analytics-time.js';

interface RecommendationReceipt {
  id: string;
  sessionId: string;
  accountId?: string;
  issuedAt: number;
  packages: Array<{ packageId: number; sourceType?: string }>;
}

export interface SearchContext {
  sessionId?: string;
  accountId?: string;
  searchRequestId?: string;
  branchId?: number;
}

@Injectable()
export class AnalyticsService {
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
    const data = {
      sessionId: receipt.sessionId, accountId, targetType: 'PACKAGE', targetId: dto.targetId,
      recommendationId: receipt.id, recommendationSource: receipt.packages[position].sourceType || 'POPULAR',
      position: position + 1, occurredAt,
    };
    // A fast click also proves visibility. One package contributes once per response, including retries.
    const events = [{ ...data, eventType: 'RECOMMEND_IMPRESSION' }];
    if (dto.eventType === 'RECOMMEND_CLICK') events.push({ ...data, eventType: 'RECOMMEND_CLICK' });
    return this.prisma.$transaction(async tx => {
      await tx.analyticsInteraction.createMany({ data: events, skipDuplicates: true });
      const click = dto.eventType === 'RECOMMEND_CLICK' ? await tx.analyticsInteraction.findFirst({
        where: { recommendationId: receipt.id, targetId: dto.targetId, eventType: 'RECOMMEND_CLICK' },
        select: { id: true },
      }) : null;
      return { success: true, ...(click ? { sourceViewId: click.id } : {}) };
    });
  }

  async recordSearch(query: string, context: SearchContext, result: {
    branchId?: number; packages: Array<{ id: number }>; doctors: Array<{ id: string }>; branches: Array<{ id: number }>;
    partial?: boolean;
  } | null, latencyMs: number) {
    // Scope the execution ID to its owner, query and branch; retries share one database row.
    const key = context.searchRequestId && context.sessionId
      ? createHash('sha256').update(JSON.stringify([context.searchRequestId, context.sessionId, context.accountId,
        query.trim().toLowerCase(), context.branchId])).digest('hex') : undefined;
    const status = result ? result.partial ? 'PARTIAL' : result.packages.length + result.doctors.length + result.branches.length ? 'SUCCESS' : 'EMPTY' : 'ERROR';
    return this.prisma.$transaction(async tx => {
      // Serialize retries without overriding the database-generated integer ID.
      if (key) {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${key}))`;
        const existing = await tx.searchRequest.findFirst({
          where: { intent: { path: ['requestKey'], equals: key } },
          select: { id: true },
        });
        if (existing) return { id: existing.id, created: false };
      }
      const inserted = await tx.searchRequest.create({ data: {
        sessionId: context.sessionId || `legacy_${randomUUID()}`, accountId: context.accountId,
        branchId: result?.branchId || context.branchId, query: query.slice(0, 200), normalizedQuery: normalizeSearch(query),
        intent: JSON.parse(JSON.stringify({ ...parseSearchIntent(query), ...(key ? { requestKey: key } : {}) })),
        resultKeys: result ? [
          ...result.packages.map(item => `PACKAGE:${item.id}`), ...result.doctors.map(item => `DOCTOR:${item.id}`), ...result.branches.map(item => `BRANCH:${item.id}`),
        ] : [],
        status, packageCount: result?.packages.length || 0, doctorCount: result?.doctors.length || 0,
        branchCount: result?.branches.length || 0, latencyMs: Math.max(0, Math.round(latencyMs)),
      }, select: { id: true } });
      if (status === 'SUCCESS' || status === 'EMPTY') {
        const keyword = query.trim().toLowerCase();
        const dateKey = vietnamDateKey(new Date());
        const hasResults = status === 'SUCCESS';
        await tx.searchLog.upsert({ where: { keyword_dateKey_hasResults: { keyword, dateKey, hasResults } },
          update: { count: { increment: 1 } }, create: { keyword, dateKey, hasResults, count: 1 } });
      }
      return { id: inserted.id, created: true };
    });
  }

  async recordInteraction(dto: AnalyticsInteractionDto, accountId?: string) {
    if (dto.targetType === 'DOCTOR' ? (!dto.targetDoctorId || dto.targetId != null) : (!dto.targetId || dto.targetDoctorId != null)) {
      throw new BadRequestException('Bác sĩ sử dụng targetDoctorId UUID; gói khám và chi nhánh sử dụng targetId số nguyên.');
    }
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
      const key = `${dto.targetType}:${dto.targetType === 'DOCTOR' ? dto.targetDoctorId : dto.targetId}`;
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
      const ids = [...new Set([pkg.branchBookingMethod?.branchId, ...pkg.branchBookingMethods.map(link => link.branchBookingMethod.branchId)].filter((id): id is number => id != null))];
      if (branchId && !ids.includes(branchId)) throw new BadRequestException('Gói khám không thuộc cơ sở này.');
      branchId = branchId || (ids.length === 1 ? ids[0] : undefined);
    } else if (dto.eventType === 'PACKAGE_VIEW') {
      throw new BadRequestException('Loại lượt xem không hợp lệ.');
    }
    return this.prisma.$transaction(async tx => {
      // Retries retain their timestamp and target; IDs are generated by the database.
      const eventKey = JSON.stringify([dto.sessionId, dto.eventType, dto.targetType, dto.targetId, dto.targetDoctorId, occurredAt]);
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${eventKey}))`;
      const existing = await tx.analyticsInteraction.findFirst({
        where: { sessionId: dto.sessionId, accountId: accountId ?? null, eventType: dto.eventType,
          targetType: dto.targetType, targetId: dto.targetId ?? null, targetDoctorId: dto.targetDoctorId ?? null, occurredAt },
        select: { id: true },
      });
      const interaction = existing || await tx.analyticsInteraction.create({
        data: { ...data, id: undefined, occurredAt, branchId, accountId }, select: { id: true },
      });
      return { success: true, ...(dto.eventType === 'PACKAGE_VIEW' ? { sourceViewId: interaction.id } : {}) };
    });
  }

  /** Attribution is optional and never creates a conversion from an unrelated/stale event. */
  async attribution(tx: Prisma.TransactionClient, accountId: string, source: {
    analyticsSessionId?: string; searchId?: number; sourceViewId?: number;
  }, target: { branchId: number; packageId?: number | null; doctorId?: string }) {
    const since = new Date(Date.now() - 24 * 3600_000);
    const owner = { sessionId: source.analyticsSessionId || '', AND: [{ OR: [{ accountId: null }, { accountId }] }] };
    let searchId: number | undefined;
    let sourceViewId: number | undefined;
    if (source.searchId && source.analyticsSessionId) {
      const search = await tx.searchRequest.findFirst({ where: { id: source.searchId, ...owner, createdAt: { gte: since } }, select: { id: true } });
      if (search) {
        const click = await tx.analyticsInteraction.findFirst({ where: {
          searchId: search.id, ...owner, eventType: 'RESULT_CLICK',
          OR: [
            ...(target.packageId ? [{ targetType: 'PACKAGE', targetId: target.packageId }] : []),
            ...(target.doctorId ? [{ targetType: 'DOCTOR', targetDoctorId: target.doctorId }] : []),
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
}
