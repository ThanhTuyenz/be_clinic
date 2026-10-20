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
const { plainToInstance } = require('class-transformer');
const { validateSync } = require('class-validator');
const { BehaviorTelemetryService } = require('../src/modules/recommendations/services/behavior-telemetry.service.ts');
const { SemanticSearchService } = require('../src/modules/recommendations/services/semantic-search.service.ts');
const { TrackBehaviorDto } = require('../src/modules/recommendations/recommendation.dto.ts');

function fixture() {
  const hashes = new Map(), markers = new Set(), counters = [], invalidations = [];
  let appointment, views = 0;
  const hash = key => { if (!hashes.has(key)) hashes.set(key, {}); return hashes.get(key); };
  const client = {
    set: async key => { if (markers.has(key)) return null; markers.add(key); return 'OK'; },
    eval: async (_, _count, key, field, amount, cap) => { const h = hash(key); h[field] = String(Math.min(Number(h[field] || 0) + amount, cap)); },
    pipeline() {
      const jobs = [];
      const pipeline = {
        hset(key, field, value) { jobs.push(() => { hash(key)[field] = value; }); return pipeline; },
        expire() { return pipeline; },
        zincrby(key, amount, member) { jobs.push(() => counters.push({ key, amount, member })); return pipeline; },
        async exec() { jobs.forEach(job => job()); },
      };
      return pipeline;
    },
  };
  const prisma = {
    specialty: { findMany: async ({ where }) => where.id.in.map(id => ({ id, name: 'Chuyên khoa' })) },
    servicePackage: { findUnique: async () => ({ specialtyId: 7 }), update: async () => { views++; } },
    appointment: { findFirst: async ({ where }) => {
      assert.equal(where.status, 'CANCELLED');
      assert.deepEqual(where.statusHistories.some.reason.in, ['PAYMENT_HOLD_TIMEOUT', 'PAYMENT_CANCELLED']);
      return appointment;
    } },
  };
  const redis = { isEnabled: () => true, getClient: () => client, hgetall: async key => hashes.get(key), deletePattern: async pattern => {
    invalidations.push({ pattern, hashes: structuredClone([...hashes]) });
  } };
  return { service: new BehaviorTelemetryService(prisma, redis), hashes, counters, invalidations,
    views: () => views, setAppointment(value) { appointment = value; } };
}

test('executed search updates guest/account interests once and invalidates cache after writing intent', async () => {
  const f = fixture(), logs = [];
  const search = new SemanticSearchService({}, {}, {}, { recordSearch: async (...args) => { logs.push(args); return 'search-id'; } }, f.service);
  search.runSearch = async () => ({ query: 'tim mạch', total: 2, packages: [{ id: 'a', specialtyId: 7 }, { id: 'b', specialtyId: 7 }], doctors: [], branches: [] });
  const result = await search.semanticSearchPackages(' Tim Mạch ', undefined, { sessionId: 'session', accountId: 'owner' });
  assert.equal(result.searchId, 'search-id');
  assert.equal(logs.length, 1);
  for (const key of ['rec:guest_interest:session', 'rec:user_interest:owner']) {
    assert.equal(f.hashes.get(key).last_search_query, 'tim mạch');
    assert.equal(f.hashes.get(key)['specialty:7'], '3');
  }
  assert.ok(f.invalidations.every(item => item.hashes.every(([, h]) => h.last_search_query === 'tim mạch')));
  assert.equal(f.views(), 0);
});

test('partial/failed searches never become intent; multi-specialty results never guess a specialty', async () => {
  for (const mode of ['partial', 'error', 'multiple', 'empty']) {
    const events = [];
    const search = new SemanticSearchService({}, {}, {}, { recordSearch: async () => 'search-id' }, { trackUserBehavior: async event => events.push(event) });
    search.runSearch = async () => {
      if (mode === 'error') throw new Error('gateway');
      return { partial: mode === 'partial', packages: mode === 'empty' ? [] : [{ specialtyId: 7 }, { specialtyId: 8 }], doctors: [], branches: [] };
    };
    const request = search.semanticSearchPackages('sức khỏe', undefined, { sessionId: 'session' });
    if (mode === 'error') await assert.rejects(request, /gateway/); else await request;
    assert.equal(events.length, ['partial', 'error'].includes(mode) ? 0 : 1);
    if (events.length) assert.equal(events[0].targetSpecialtyId, undefined);
  }
});

test('cancelled family holds record one drop-off per package without counting a package view', async () => {
  const f = fixture();
  f.setAppointment({ id: 'a', bookingOrderId: 'order', servicePackageId: 'package', patientProfile: { accountId: 'child-owner' },
    bookingOrder: { accountId: 'owner', invoice: { payments: [] } }, sourceView: { sessionId: 'session' } });
  await f.service.recordAbandonedBooking('a');
  await f.service.recordAbandonedBooking('b');
  assert.equal(f.hashes.get('rec:user_interest:owner')['specialty:7'], '5');
  assert.equal(f.hashes.get('rec:guest_interest:session').drop_off_pkg, 'package');
  assert.equal(f.hashes.has('rec:user_interest:child-owner'), false);
  assert.equal(f.counters.some(item => item.key === 'rec:global:package_views'), false);
  assert.equal(f.views(), 0);
});

test('paid/non-cancelled bookings do not produce drop-offs; account-only events never create undefined guest keys', async () => {
  const f = fixture();
  await f.service.recordAbandonedBooking('not-cancelled');
  f.setAppointment({ id: 'a', servicePackageId: 'package', patientProfile: { accountId: 'owner' }, invoice: { payments: [{ id: 'paid' }] } });
  await f.service.recordAbandonedBooking('a');
  assert.equal(f.hashes.size, 0);
  f.setAppointment({ id: 'a', servicePackageId: 'package', patientProfile: { accountId: 'owner' } });
  await f.service.recordAbandonedBooking('a');
  assert.deepEqual([...f.hashes.keys()], ['rec:user_interest:owner']);
});

test('the public tracking endpoint cannot fabricate searches or drop-offs', () => {
  for (const actionType of ['VIEW_PACKAGE', 'SEARCH', 'DROP_OFF']) {
    const errors = validateSync(plainToInstance(TrackBehaviorDto, { sessionId: 'session', actionType, targetPackageId: 'package' }));
    assert.equal(errors.length === 0, actionType === 'VIEW_PACKAGE');
  }
});

test('legacy unverified drop-offs are ignored while confirmed abandonment remains usable for recommendations', async () => {
  const f = fixture();
  f.hashes.set('rec:guest_interest:session', { drop_off_pkg: 'old-package', drop_off_at: '1' });
  assert.equal((await f.service.getBehaviorTelemetryContext(undefined, 'session')).dropOffPkgId, undefined);
  f.setAppointment({ id: 'a', servicePackageId: 'package', patientProfile: { accountId: 'owner' }, sourceView: { sessionId: 'session' } });
  await f.service.recordAbandonedBooking('a');
  assert.equal((await f.service.getBehaviorTelemetryContext('owner', 'session')).dropOffPkgId, 'package');
});
