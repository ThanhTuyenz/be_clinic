require('ts-node/register/transpile-only');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
  if (request.startsWith('src/')) request = path.resolve(__dirname, '..', request);
  if (request.endsWith('.js') && parent) {
    const source = path.resolve(path.dirname(parent.filename), request.slice(0, -3) + '.ts');
    if (fs.existsSync(source)) return resolve.call(this, source, parent, ...rest);
  }
  return resolve.call(this, request, parent, ...rest);
};
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { SearchAnalyticsService } = require('../src/modules/search-analytics/search-analytics.service.ts');
const { SearchAnalyticsController } = require('../src/modules/search-analytics/search-analytics.controller.ts');
const { RolesGuard } = require('../src/common/guards/roles.guard.ts');
const config = { getOrThrow: () => 'test-recommendation-signing-secret' };
const sessionId = 'guest-session-measurement';
const packageId = randomUUID();
function fixture() {
  const records = new Map();
  const service = new SearchAnalyticsService({ analyticsInteraction: { createMany: async ({ data }) => {
    for (const row of data) if (!records.has(row.id)) records.set(row.id, row);
  } } }, config);
  const token = service.createRecommendationToken([{ packageId, sourceType: 'BOTH' }], sessionId, 'owner');
  const dto = { id: randomUUID(), sessionId, recommendationToken: token, eventType: 'RECOMMEND_CLICK', targetType: 'PACKAGE', targetId: packageId, position: 1 };
  return { service, records, token, dto };
}

test('signed recommendations record real positions/source and deduplicate impressions, clicks and retries', async () => {
  const f = fixture();
  await f.service.recordInteraction({ ...f.dto, eventType: 'RECOMMEND_IMPRESSION' }, 'owner');
  const first = await f.service.recordInteraction(f.dto, 'owner');
  const second = await f.service.recordInteraction({ ...f.dto, id: randomUUID() }, 'owner');
  assert.equal(first.sourceViewId, second.sourceViewId);
  assert.equal(f.records.size, 2);
  assert.deepEqual([...f.records.values()].map(row => row.eventType).sort(), ['RECOMMEND_CLICK', 'RECOMMEND_IMPRESSION']);
  assert.ok([...f.records.values()].every(row => row.recommendationSource === 'BOTH' && row.position === 1));
  assert.equal(f.service.createRecommendationToken([{ packageId }]), undefined);
});

test('clients cannot forge package, position, signature, owner, session or expired recommendation receipts', async () => {
  const f = fixture();
  for (const patch of [{ targetId: randomUUID() }, { position: 2 }, { sessionId: 'another-session' },
    { recommendationToken: f.token + 'x' }, { recommendationToken: 'invalid' }, { targetType: 'DOCTOR' },
    { occurredAt: new Date(Date.now() + 3600_000).toISOString() }]) {
    await assert.rejects(f.service.recordInteraction({ ...f.dto, ...patch }, 'owner'), error => error.getStatus() === 400);
  }
  await assert.rejects(f.service.recordInteraction(f.dto, 'other-owner'), error => error.getStatus() === 400);
  const originalNow = Date.now;
  Date.now = () => originalNow() + 25 * 3600_000;
  try { await assert.rejects(f.service.recordInteraction(f.dto, 'owner'), error => error.getStatus() === 400); }
  finally { Date.now = originalNow; }
  assert.equal(f.records.size, 0);
});

test('recommendation attribution checks same account/session/package, branch and 24 hour click window', async () => {
  const f = fixture();
  const { sourceViewId } = await f.service.recordInteraction(f.dto, 'owner');
  let filter;
  const tx = { analyticsInteraction: { findFirst: async ({ where }) => { filter = where; return { id: sourceViewId }; } } };
  assert.deepEqual(await f.service.attribution(tx, 'owner', { analyticsSessionId: sessionId, sourceViewId }, { packageId, branchId: 'branch' }), { searchId: undefined, sourceViewId });
  assert.equal(filter.targetId, packageId);
  assert.equal(filter.targetType, 'PACKAGE');
  assert.deepEqual(filter.eventType.in, ['PACKAGE_VIEW', 'RECOMMEND_CLICK']);
  assert.equal(filter.sessionId, sessionId);
  assert.deepEqual(filter.AND, [{ OR: [{ accountId: null }, { accountId: 'owner' }] }]);
  assert.deepEqual(filter.OR, [{ branchId: null }, { branchId: 'branch' }]);
  assert.ok(filter.occurredAt.gte instanceof Date);
});

test('metrics distinguish held checkouts from successful bookings and preserve zero-data null rates', async () => {
  const service = new SearchAnalyticsService({ $queryRaw: async () => [
    { source: 'BOTH', packageId, packageName: 'Gói khám', impressions: 10n, clicks: 4n, checkouts: 3n, bookings: 2n, paid: 1n },
    { source: 'POPULAR', packageId, packageName: 'Gói khám', impressions: 10n, clicks: 1n, checkouts: 1n, bookings: 0n, paid: 0n },
  ] }, config);
  const report = await service.recommendationMetrics({});
  assert.deepEqual(report.totals, { impressions: 20, clicks: 5, checkouts: 4, bookings: 2, paid: 1, ctr: 25, bookingRate: 10, clickToBookingRate: 40 });
  assert.equal(report.bySource[0].ctr, 40);
  assert.equal(report.byPackage.length, 1);
  assert.equal(report.byPackage[0].packageId, packageId);
  assert.equal(report.byPackage[0].impressions, 20);
  const empty = new SearchAnalyticsService({ $queryRaw: async () => [] }, config);
  assert.equal((await empty.recommendationMetrics({})).totals.ctr, null);
  await assert.rejects(service.recommendationMetrics({ start: '2026-01-01', end: '2026-10-01' }), error => error.getStatus() === 400);
});

test('aggregate metrics require chain management roles and an active role guard', () => {
  const handler = SearchAnalyticsController.prototype.recommendationMetrics;
  assert.deepEqual(Reflect.getMetadata('roles', handler), ['CHAIN_MANAGER', 'SUPER_ADMIN']);
  assert.ok(Reflect.getMetadata('__guards__', handler).includes(RolesGuard));
  const guard = new RolesGuard({ getAllAndOverride: () => ['CHAIN_MANAGER', 'SUPER_ADMIN'] });
  const request = role => ({ getHandler: () => handler, getClass: () => SearchAnalyticsController,
    switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }) });
  assert.equal(guard.canActivate(request('PATIENT')), false);
  assert.equal(guard.canActivate(request('CHAIN_MANAGER')), true);
});

test('PostgreSQL measurement joins count conversions once, exclude HOLD/CANCELLED and see paid invoices', {
  skip: process.env.RUN_RECOMMENDATION_DB_TESTS !== '1',
}, async () => {
  require('dotenv').config({ path: '.env', quiet: true });
  require('dotenv').config({ path: '.env.development', override: true, quiet: true });
  const { PrismaService } = require('../src/infrastructure/database/prisma/prisma.service.ts');
  const prisma = new PrismaService();
  const rollback = new Error('rollback recommendation fixture');
  try {
    await assert.rejects(prisma.$transaction(async tx => {
      const baselineService = new SearchAnalyticsService(tx, config);
      const start = new Date(Date.now() - 60000).toISOString();
      const before = (await baselineService.recommendationMetrics({ start })).totals;
      const suffix = randomUUID();
      const user = await tx.user.create({ data: { fullName: 'Measurement test' } });
      const profile = await tx.patientProfile.create({ data: { accountId: user.id, fullName: 'Measurement test', dateOfBirth: new Date('2000-01-01') } });
      const clinic = await tx.clinic.create({ data: { name: 'Measurement test', slug: suffix } });
      const branch = await tx.branch.create({ data: { clinicId: clinic.id, code: suffix.slice(0, 20), name: 'Measurement test' } });
      const pkg = await tx.servicePackage.create({ data: { code: suffix, name: 'Measurement test', price: 100000 } });
      const sample = { patientProfileId: profile.id, branchId: branch.id, servicePackageId: pkg.id };
      const owner = user.id;
      const token = baselineService.createRecommendationToken([{ packageId: sample.servicePackageId, sourceType: 'BOTH' }], randomUUID(), owner);
      const receipt = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
      const dto = { id: randomUUID(), sessionId: receipt.sessionId, recommendationToken: token,
        eventType: 'RECOMMEND_CLICK', targetType: 'PACKAGE', targetId: sample.servicePackageId, position: 1 };
      const click = await baselineService.recordInteraction(dto, owner);
      await baselineService.recordInteraction({ ...dto, id: randomUUID() }, owner);
      const source = await baselineService.attribution(tx, owner, { analyticsSessionId: dto.sessionId, sourceViewId: click.sourceViewId }, { branchId: sample.branchId, packageId: sample.servicePackageId });
      const appointment = await tx.appointment.create({ data: {
        patientProfileId: sample.patientProfileId, branchId: sample.branchId,
        servicePackageId: sample.servicePackageId, status: 'HOLD', ...source,
      } });
      const report = async () => (await baselineService.recommendationMetrics({ start })).totals;
      let totals = await report();
      assert.equal(totals.impressions, before.impressions + 1);
      assert.equal(totals.clicks, before.clicks + 1);
      assert.equal(totals.checkouts, before.checkouts + 1);
      assert.equal(totals.bookings, before.bookings);
      await tx.appointment.update({ where: { id: appointment.id }, data: { status: 'CONFIRMED' } });
      await tx.invoice.create({ data: { appointmentId: appointment.id, issuedBranchId: sample.branchId, totalAmount: 100000, status: 'PAID' } });
      totals = await report();
      assert.equal(totals.bookings, before.bookings + 1);
      assert.equal(totals.paid, before.paid + 1);
      // A family booking can contain several appointments from the same exposure: one conversion.
      await tx.appointment.create({ data: { patientProfileId: sample.patientProfileId, branchId: sample.branchId,
        servicePackageId: sample.servicePackageId, status: 'CONFIRMED', ...source } });
      assert.equal((await report()).bookings, before.bookings + 1);
      await tx.appointment.updateMany({ where: { sourceViewId: click.sourceViewId }, data: { status: 'CANCELLED' } });
      assert.equal((await report()).bookings, before.bookings);
      const wrong = await baselineService.attribution(tx, owner, { analyticsSessionId: 'wrong-session', sourceViewId: click.sourceViewId }, { branchId: sample.branchId, packageId: sample.servicePackageId });
      assert.equal(wrong.sourceViewId, undefined);
      throw rollback;
    }, { timeout: 15000 }), error => error === rollback);
  } finally { await prisma.onModuleDestroy(); }
});
