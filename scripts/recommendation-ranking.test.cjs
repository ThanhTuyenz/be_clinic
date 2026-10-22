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
const { RecommendationService } = require('../src/modules/recommendations/recommendation.service.ts');
const { CandidateRetrievalService } = require('../src/modules/recommendations/services/candidate-retrieval.service.ts');
const { AiRankingService } = require('../src/modules/recommendations/services/ai-ranking.service.ts');
const { EmbeddingService, mapPackageForRetrieval } = require('../src/infrastructure/embedding/embedding.service.ts');

function fixture() {
  const cache = new Map(), writes = [], calls = [];
  const catalog = Array.from({ length: 15 }, (_, index) => ({
    id: 'pkg-' + index, code: 'PKG-' + index, slug: 'package-' + index, name: 'Gói ' + index,
    price: 100000 + index, description: '', durationMin: 30, specialtyId: 7,
    specialty: { id: 7, name: 'Chuyên khoa', slug: 'chuyen-khoa', description: '', symptoms: [] },
    isActive: true, targetGender: 'ALL', minAge: null, maxAge: null, isPediatric: false,
    isFollowUp: false, followUpAfterDays: null, symptoms: [], viewCount: 0, updatedAt: new Date(0),
  }));
  const context = id => ({
    profile: id ? { id, fullName: id, dateOfBirth: new Date(0), gender: 'MALE', height: 170, weight: 65, medicalHistory: 'profile-history-only', allergies: '' } : null,
    age: id === 'child' ? 8 : 35, gender: 'MALE', bmi: 22, medicalHistory: 'profile-history-only', allergies: '',
    recentlyCompletedPackageIds: [], followUpSpecialtyId: null,
  });
  const telemetry = { topSpecialties: [{ specialtyId: 7, specialtyName: 'Chuyên khoa', score: 7 }], lastSearchQuery: 'behavior-query-only' };
  const rules = new AiRankingService({ get: () => undefined });
  const eligibility = new CandidateRetrievalService({}, {}, {});
  const retrieval = {
    loadActivePackages: async () => catalog.filter(pkg => pkg.isActive),
    getProfileContext: async id => context(id),
    getProfileCandidates: async profile => [0, 1, 2].map(index => ({ pkg: catalog[index], origin: 'PROFILE' })),
    getBehaviorCandidates: async () => ({ candidates: [1, 3, 4].map(index => ({ pkg: catalog[index], sourceType: 'SEARCH_INTENT' })) }),
    isPackageEligibleForProfile: (...args) => eligibility.isPackageEligibleForProfile(...args),
  };
  const ai = {
    isAiAvailable: () => true,
    rankWithOpenAI: async input => {
      calls.push(structuredClone(input));
      return rules.rankWithRules(input.candidates.map(item => ({ pkg: catalog.find(pkg => pkg.id === item.id), origin: item.origin, behaviorSourceType: item.behaviorSourceType })));
    },
    rankWithRules: (...args) => rules.rankWithRules(...args),
  };
  const redis = {
    isEnabled: () => true,
    get: async key => cache.has(key) ? structuredClone(cache.get(key)) : null,
    set: async (key, value, ttl) => { cache.set(key, structuredClone(value)); writes.push({ key, ttl }); },
    delete: async key => { cache.delete(key); },
  };
  const completions = [];
  const completionQueries = [];
  const service = new RecommendationService({
    appointment: { groupBy: async query => { completionQueries.push(query); return completions; } },
    patientProfile: { findUnique: async ({ where }) => ({ accountId: where.id === 'foreign' ? 'another-owner' : 'owner' }) } },
    redis, { getBehaviorTelemetryContext: async () => structuredClone(telemetry) }, retrieval, ai, {}, { createRecommendationToken: () => 'receipt' });
  return { service, catalog, cache, writes, calls, telemetry, retrieval, ai, redis, completions, completionQueries };
}
const request = { profileId: 'adult', sessionId: 'session' };

test('signed-out visitors ignore existing guest searches and cached personalized rankings', async () => {
  const f = fixture();
  f.catalog[12].isFeatured = true;
  // This session already has qualified search telemetry and a cached behavior ranking.
  await f.service.getHomeRecommendations({ sessionId: 'returning-guest' }, 'owner');
  assert.equal(f.calls.length, 1);
  const result = await f.service.getHomeRecommendations({ sessionId: 'returning-guest' });
  assert.equal(result.source, 'FALLBACK');
  assert.equal(result.fromCache, false);
  assert.equal(result.packages[0].packageId, 'pkg-12');
  assert.ok(result.packages.every(item => item.sourceType === 'POPULAR'));
  assert.equal(f.calls.length, 1);
});

test('new guests see featured packages first, ordered by completed visits, then popular packages without calling AI', async () => {
  const f = fixture();
  f.telemetry.topSpecialties = [];
  f.telemetry.lastSearchQuery = '';
  f.catalog[12].isFeatured = true;
  f.catalog[14].isFeatured = true;
  f.completions.push(
    { servicePackageId: 'pkg-12', _count: { _all: 2 } },
    { servicePackageId: 'pkg-14', _count: { _all: 5 } },
    { servicePackageId: 'pkg-9', _count: { _all: 20 } },
  );
  const before = Date.now();
  const result = await f.service.getHomeRecommendations({ sessionId: 'new-guest' });
  assert.equal(result.source, 'FALLBACK');
  assert.equal(f.calls.length, 0);
  assert.equal(result.packages.length, 10);
  assert.deepEqual(result.packages.slice(0, 3).map(item => item.packageId), ['pkg-14', 'pkg-12', 'pkg-9']);
  assert.equal(result.packages[0].badge, 'Gói khám nổi bật');
  assert.equal(result.packages[2].badge, 'Được khám nhiều');
  assert.equal(result.packages[3].badge, 'Gói khám tham khảo');
  const query = f.completionQueries[0];
  assert.equal(query.where.status, 'COMPLETED');
  const completion = query.where.statusHistories.some;
  assert.equal(completion.toStatus, 'COMPLETED');
  assert.ok(completion.createdAt.gte.getTime() >= before - 90 * 86400000);
  assert.equal(completion.createdAt.lte.getTime() - completion.createdAt.gte.getTime(), 90 * 86400000);
});

test('without featured flags, rank by recent completed visits; empty catalogs return no packages', async () => {
  const f = fixture();
  f.telemetry.topSpecialties = [];
  f.telemetry.lastSearchQuery = '';
  f.catalog[14].isActive = false;
  f.completions.push({ servicePackageId: 'pkg-13', _count: { _all: 8 } });
  const result = await f.service.getHomeRecommendations({});
  assert.equal(result.packages[0].packageId, 'pkg-13');
  assert.equal(result.packages.some(item => item.packageId === 'pkg-14'), false);
  f.catalog.forEach(pkg => { pkg.isActive = false; });
  assert.deepEqual((await f.service.getHomeRecommendations({})).packages, []);
});

test('profile and behavior use separate prompts/caches; backend deduplicates, labels shared packages and limits results', async () => {
  const f = fixture();
  const first = await f.service.getHomeRecommendations(request, 'owner');
  assert.equal(f.calls.length, 2);
  const profile = f.calls.find(call => call.source === 'PROFILE'), behavior = f.calls.find(call => call.source === 'BEHAVIOR');
  assert.ok(profile.profile);
  assert.equal(profile.behavior, undefined);
  assert.equal(behavior.profile, undefined);
  assert.match(behavior.behavior.lastSearchQuery, /behavior-query-only/);
  assert.equal(first.source, 'HYBRID');
  assert.equal(first.packages[0].packageId, 'pkg-1');
  assert.equal(first.packages[0].sourceType, 'BOTH');
  assert.equal(new Set(first.packages.map(item => item.packageId)).size, first.packages.length);
  assert.equal(first.packages.length, 10);
  assert.ok(f.writes.some(write => write.key.includes(':profile:adult') && write.ttl === 604800));
  assert.ok(f.writes.some(write => write.key.includes(':behavior:') && write.ttl === 86400));
  const cached = await f.service.getHomeRecommendations(request, 'owner');
  assert.equal(cached.fromCache, true);
  assert.equal(f.calls.length, 2);
});

test('behavior changes and profile switches reuse the unaffected source without sending it to LLM again', async () => {
  const f = fixture();
  await f.service.getHomeRecommendations(request, 'owner');
  f.telemetry.lastSearchQuery = 'new intent';
  await f.service.getHomeRecommendations(request, 'owner');
  assert.deepEqual(f.calls.map(call => call.source), ['PROFILE', 'BEHAVIOR', 'BEHAVIOR']);
  await f.service.getHomeRecommendations({ ...request, profileId: 'child' }, 'owner');
  assert.deepEqual(f.calls.map(call => call.source), ['PROFILE', 'BEHAVIOR', 'BEHAVIOR', 'PROFILE']);
});

test('profile refresh/invalidation changes only profile cache and home still contains cached behavior', async () => {
  const f = fixture();
  await f.service.getHomeRecommendations(request, 'owner');
  const behaviorKey = [...f.cache.keys()].find(key => key.includes(':behavior:'));
  const before = structuredClone(f.cache.get(behaviorKey));
  await f.service.invalidateCache('adult');
  await f.service.analyzeAndCacheRecommendations('adult', 'owner');
  const home = await f.service.getHomeRecommendations(request, 'owner');
  assert.deepEqual(f.cache.get(behaviorKey), before);
  assert.equal(f.calls.filter(call => call.source === 'BEHAVIOR').length, 1);
  assert.ok(home.packages.some(item => item.packageId === 'pkg-3' && item.sourceType === 'SEARCH_INTENT'));
});

test('current DB eligibility, price and completed history are enforced on both sources and defaults', async () => {
  const f = fixture();
  await f.service.getHomeRecommendations(request, 'owner');
  f.catalog[0].isActive = false;
  f.catalog[1].minAge = 18;
  f.catalog[3].targetGender = 'FEMALE';
  f.catalog[4].price = 250000;
  const getContext = f.retrieval.getProfileContext;
  f.retrieval.getProfileContext = async id => ({ ...await getContext(id), recentlyCompletedPackageIds: ['pkg-2'] });
  const child = await f.service.getHomeRecommendations({ ...request, profileId: 'child' }, 'owner');
  for (const id of ['pkg-0', 'pkg-1', 'pkg-2', 'pkg-3']) assert.equal(child.packages.some(item => item.packageId === id), false);
  assert.equal(child.packages.find(item => item.packageId === 'pkg-4').price, 250000);
});

test('view counters do not invalidate profile rankings; meaningful catalog edits invalidate both source caches', async () => {
  const f = fixture();
  await f.service.getHomeRecommendations(request, 'owner');
  f.catalog[0].viewCount++;
  f.catalog[0].updatedAt = new Date();
  await f.service.getHomeRecommendations(request, 'owner');
  assert.equal(f.calls.length, 2);
  f.catalog[0].price++;
  await f.service.getHomeRecommendations(request, 'owner');
  assert.equal(f.calls.length, 4);
});

test('simultaneous requests share in-flight work per source; unauthorized profiles never reach LLM', async () => {
  const f = fixture();
  const rank = f.ai.rankWithOpenAI;
  f.ai.rankWithOpenAI = async input => { await new Promise(resolve => setTimeout(resolve, 5)); return rank(input); };
  await Promise.all(Array.from({ length: 3 }, () => f.service.getHomeRecommendations(request, 'owner')));
  assert.equal(f.calls.length, 2);
  await assert.rejects(f.service.getHomeRecommendations({ ...request, profileId: 'foreign' }, 'owner'), error => error.getStatus() === 403);
  assert.equal(f.calls.length, 2);
});

test('failed AI uses short-lived independent rule caches; cold starts never call LLM', async () => {
  const f = fixture();
  f.ai.rankWithOpenAI = async input => { f.calls.push(input); return []; };
  const result = await f.service.getHomeRecommendations(request, 'owner');
  assert.ok(result.packages.length);
  assert.ok(f.writes.every(write => write.ttl === 300));
  await f.service.getHomeRecommendations(request, 'owner');
  assert.equal(f.calls.length, 2);
  const cold = fixture();
  cold.telemetry.lastSearchQuery = undefined;
  cold.telemetry.topSpecialties = [];
  assert.equal((await cold.service.getHomeRecommendations({})).source, 'FALLBACK');
  assert.equal(cold.calls.length, 0);
});

test('actual prompt builder sends only the chosen source and rejects hallucinated IDs/source labels', async () => {
  const ai = new AiRankingService({ get: key => key === 'openai.apiKey' ? 'test-key' : undefined });
  const prompts = [];
  ai.aiClient = { responses: { create: async input => {
    assert.equal(input.store, false);
    assert.equal(input.text.format.strict, true);
    prompts.push(input.input);
    return { status: 'completed', output_text: JSON.stringify({ selectedPackages: [{ packageId: 'ghost' }, { packageId: 'a', sourceType: 'PROFILE_AI', priority: 'HIGH', clinicalReason: 'Tham khảo' }] }) };
  } } };
  const candidate = { id: 'a', code: 'A', name: 'Gói A', description: '', price: 100000, specialtyName: 'Chuyên khoa', specialtyId: 7, durationMin: 30 };
  await ai.rankWithOpenAI({ source: 'PROFILE', profile: { age: 30, gender: 'MALE', bmi: null, medicalHistory: 'private-profile-only', allergies: '' }, candidates: [{ ...candidate, origin: 'PROFILE' }] });
  const behavior = await ai.rankWithOpenAI({ source: 'BEHAVIOR', behavior: { topSpecialties: 'Chuyên khoa', lastSearchQuery: 'behavior-intent-only' }, candidates: [{ ...candidate, origin: 'BEHAVIOR', behaviorSourceType: 'SEARCH_INTENT' }] });
  assert.equal(prompts[0].includes('behavior-intent-only'), false);
  assert.equal(prompts[1].includes('private-profile-only'), false);
  assert.equal(prompts[1].includes('"profile"'), false);
  assert.deepEqual(behavior.map(item => [item.packageId, item.sourceType]), [['a', 'SEARCH_INTENT']]);
});

test('account/session cache scopes remain isolated and old combined caches are never reused', async () => {
  const f = fixture();
  f.cache.set('rec:v2:home:u:owner:adult', { packages: [{ packageId: 'stale-combined' }] });
  await f.service.getHomeRecommendations(request, 'owner');
  await f.service.getHomeRecommendations({ sessionId: 'session' }, 'another-owner');
  await f.service.getHomeRecommendations({ sessionId: 'session' });
  await f.service.getHomeRecommendations({ sessionId: 'another-session' });
  assert.equal(f.calls.filter(item => item.source === 'PROFILE').length, 1);
  assert.equal(f.calls.filter(item => item.source === 'BEHAVIOR').length, 2);
  assert.equal([...f.cache.keys()].filter(key => key.includes(':behavior:')).length, 2);
});

test('missing birth dates stay unknown instead of inventing age 30 for ranking', async () => {
  const retrieval = new CandidateRetrievalService({ patientProfile: { findUnique: async () => ({
    id: 'unknown-age', fullName: 'Người khám', dateOfBirth: null, gender: 'MALE',
  }) }, appointment: { findMany: async () => [] } }, {}, {});
  const context = await retrieval.getProfileContext('unknown-age');
  assert.equal(context.age, null);
  assert.equal(retrieval.isPackageEligibleForProfile({ name: 'Gói khám', description: '', targetGender: 'ALL', minAge: 18 }, context), false);
});

test('an explicit profile refresh never reuses a concurrent old cache read', async () => {
  const f = fixture();
  await f.service.getHomeRecommendations(request, 'owner');
  let unblock;
  const blocked = new Promise(resolve => { unblock = resolve; });
  const read = f.redis.get;
  f.redis.get = async key => {
    const value = await read(key);
    if (key.endsWith(':profile:adult')) await blocked;
    return value;
  };
  const home = f.service.getHomeRecommendations(request, 'owner');
  await new Promise(setImmediate);
  try {
    await f.service.analyzeAndCacheRecommendations('adult', 'owner');
    assert.equal(f.calls.filter(item => item.source === 'PROFILE').length, 2);
    assert.equal(f.calls.filter(item => item.source === 'BEHAVIOR').length, 1);
  } finally { unblock(); await home; }
});

test('background profile jobs reuse a valid foreground cache instead of paying for another LLM call', async () => {
  const f = fixture();
  await f.service.getHomeRecommendations(request, 'owner');
  await f.service.analyzeAndCacheRecommendations('adult', undefined, undefined, true);
  assert.equal(f.calls.length, 2);
  await f.service.analyzeAndCacheRecommendations('adult', 'owner');
  assert.equal(f.calls.length, 3);
});

test('incomplete OpenAI responses never become partial cached rankings', async () => {
  const ai = new AiRankingService({ get: () => undefined });
  ai.aiClient = { responses: { create: async () => ({ status: 'incomplete', output_text: '{"selectedPackages":[]}' }) } };
  assert.deepEqual(await ai.rankWithOpenAI({ source: 'BEHAVIOR', behavior: { topSpecialties: '', lastSearchQuery: 'tim mạch' }, candidates: [{ id: 'a' }] }), []);
});

test('OpenAI embeddings reject wrong dimensions and never log profile text or provider secrets', async () => {
  const service = new EmbeddingService({ get: () => undefined }, { isEnabled: () => false });
  const warnings = [];
  service.logger = { warn: message => warnings.push(message) };
  service.aiClient = { embeddings: { create: async request => {
    assert.equal(request.dimensions, 1536);
    assert.equal(request.encoding_format, 'float');
    return { data: [{ embedding: [1, 2, 3] }] };
  } } };
  assert.equal(await service.embedText('private medical history'), null);
  service.aiClient.embeddings.create = async () => { throw { status: 429, message: 'secret-key private medical history' }; };
  assert.equal(await service.embedText('private medical history'), null);
  assert.ok(warnings.every(message => !message.includes('private') && !message.includes('secret-key')));
});

test('package vectors isolate OpenAI from Gemini and refresh only when embedding content changes', async () => {
  const hashes = new Map();
  const client = {
    hgetBuffer: async (key, field) => hashes.get(key)?.[field],
    hget: async (key, field) => hashes.get(key)?.[field],
    hset: async (key, ...fields) => hashes.set(key, Object.fromEntries(Array.from({ length: fields.length / 2 }, (_, i) => fields.slice(i * 2, i * 2 + 2)))),
    del: async () => 0,
  };
  hashes.set('pkg_vss:a', { vector: Buffer.from(new Float32Array(3072).buffer) });
  const service = new EmbeddingService({ get: () => undefined }, { isEnabled: () => true, getClient: () => client });
  service.logger = { warn: () => {}, log: () => {} };
  let calls = 0;
  service.embedText = async () => { calls++; return Array(1536).fill(0.25); };
  const pkg = { id: 'a', code: 'A', name: 'Khám Tim mạch', description: 'Khám sức khỏe', specialtyName: 'Tim mạch', price: 100000 };
  assert.equal((await service.getOrComputePackageVector(pkg)).length, 1536);
  assert.equal((await service.getOrComputePackageVector(pkg)).length, 1536);
  assert.equal(calls, 1);
  await service.getOrComputePackageVector({ ...pkg, description: 'Nội dung đã cập nhật' });
  assert.equal(calls, 2);
  assert.ok(hashes.has(service.vectorKeyPrefix + 'a'));
  assert.equal(hashes.get('pkg_vss:a').vector.length, 3072 * 4);
});

test('embedding input includes the same specialty description and symptoms for every producer', () => {
  const source = { id: 'a', code: 'A', name: 'Khám', description: 'Mô tả gói', price: '100000', durationMin: 30,
    specialtyId: 7, symptoms: ['Đau đầu'], specialty: { name: 'Thần kinh', description: 'Mô tả chuyên khoa', symptoms: ['Đau đầu', 'Chóng mặt'] } };
  const retrieval = new CandidateRetrievalService({}, {}, {});
  const shared = mapPackageForRetrieval(source);
  assert.deepEqual(retrieval.mapToRetrievalPackage(source), shared);
  assert.equal(shared.description, 'Mô tả gói - Mô tả chuyên khoa');
  assert.deepEqual(shared.symptoms, ['Đau đầu', 'Chóng mặt']);
  assert.equal(shared.price, 100000);
});

test('a reserved follow-up candidate shares the 20-candidate budget with vector matches', async () => {
  const f = fixture();
  const catalog = Array.from({ length: 40 }, (_, i) => ({ ...f.catalog[0], id: 'candidate-' + i, isFollowUp: i === 0 }));
  let requested;
  const retrieval = new CandidateRetrievalService({}, {
    buildPatientEmbeddingText: () => 'synthetic profile',
    retrieveTopPackages: async (text, packages, limit) => { requested = limit; return packages.slice(0, limit).map(pkg => ({ package: pkg })); },
  }, {});
  const context = { profile: { id: 'p' }, age: 35, gender: 'MALE', bmi: 22, medicalHistory: '', allergies: '', recentlyCompletedPackageIds: [], followUpSpecialtyId: 7 };
  const candidates = await retrieval.getProfileCandidates(context, catalog);
  assert.equal(requested, 19);
  assert.equal(candidates.length, 20);
  assert.equal(candidates[0].isFollowUp, true);
});

test('evaluation labels cover specialty-null packages explicitly and reject unreviewed additions', async () => {
  const { buildEvaluationLabels } = await import('./evaluate-accuracy.mjs');
  const catalog = [
    { id: 'consult', code: 'CONSULT', name: 'Khám Mắt', specialty: { name: 'Mắt' } },
    { id: 'eye', code: 'PKG-EYE-COMPREHENSIVE-VC-EAST', name: 'Đo thị lực', specialty: null },
  ];
  const labels = buildEvaluationLabels(catalog);
  assert.deepEqual(labels[1].specialtyNames, ['Mắt']);
  assert.equal(labels[1].source, 'PACKAGE_CONTENT_ANNOTATION');
  assert.equal(catalog[1].specialty, null);
  assert.throws(() => buildEvaluationLabels([...catalog, { id: 'new', code: 'NEW', name: 'Mắt', specialty: null }]), /explicit evaluation-label review/);
});

test('background vector jobs use current DB metadata and never mark a failed embedding as processed', async () => {
  const { RabbitMqService } = require('../src/infrastructure/messaging/rabbitmq/rabbitmq.service.ts');
  for (const success of [true, false]) {
    const service = Object.create(RabbitMqService.prototype);
    let consume, processed = 0, acknowledged = 0, rejected = 0, mapped;
    service.channel = { consume: async (queue, fn) => { consume = fn; }, ack: () => acknowledged++, nack: () => rejected++ };
    service.logger = { error: () => {}, log: () => {}, warn: () => {} };
    service.prisma = {
      processedEvent: { findUnique: async () => null, create: async () => processed++ },
      servicePackage: { findUnique: async () => ({ id: 'a', code: 'A', name: 'Current name', description: 'Current description',
        price: 1, durationMin: 30, specialtyId: 7, isActive: true, specialty: { name: 'Current specialty', description: 'Specialty description', symptoms: ['Current symptom'] } }) },
    };
    service.embeddingService = { getOrComputePackageVector: async pkg => { mapped = pkg; return success ? [1] : null; } };
    await service.consumePackageVectorSync();
    await consume({ content: Buffer.from(JSON.stringify({ eventId: 'e', packageId: 'a', name: 'Old queued name', description: 'Old queued description' })) });
    assert.equal(mapped.name, 'Current name');
    assert.equal(mapped.description, 'Current description - Specialty description');
    assert.deepEqual(mapped.symptoms, ['Current symptom']);
    assert.equal(processed, success ? 1 : 0);
    assert.equal(acknowledged, success ? 1 : 0);
    assert.equal(rejected, success ? 0 : 1);
  }
});
