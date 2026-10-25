require('ts-node/register/transpile-only');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { randomUUID, createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { AsyncLocalStorage } = require('node:async_hooks');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
process.chdir(root);
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
  if (request.startsWith('src/')) request = path.resolve(root, request);
  if (request.endsWith('.js') && parent) {
    const source = path.resolve(path.dirname(parent.filename), request.slice(0, -3) + '.ts');
    if (fs.existsSync(source)) return resolve.call(this, source, parent, ...rest);
  }
  return resolve.call(this, request, parent, ...rest);
};
require('dotenv').config({ path: '.env', quiet: true });
require('dotenv').config({ path: process.env.ENV_FILE || '.env.development', override: true, quiet: true });
const { Logger } = require('@nestjs/common');
Logger.overrideLogger(false);
const { PrismaService } = require('../src/infrastructure/database/prisma/prisma.service.ts');
const { RedisService } = require('../src/infrastructure/redis/redis.service.ts');
const { EmbeddingService } = require('../src/infrastructure/embedding/embedding.service.ts');
const { BehaviorTelemetryService } = require('../src/modules/recommendations/services/behavior-telemetry.service.ts');
const { CandidateRetrievalService } = require('../src/modules/recommendations/services/candidate-retrieval.service.ts');
const { AiRankingService } = require('../src/modules/recommendations/services/ai-ranking.service.ts');
const { RecommendationService } = require('../src/modules/recommendations/recommendation.service.ts');
const { SearchAnalyticsService } = require('../src/modules/search-analytics/search-analytics.service.ts');
const { TELEMETRY_CONFIG } = require('../src/modules/recommendations/constants/recommendation.constants.ts');

const runId = randomUUID();
const storage = new AsyncLocalStorage();
const output = path.join(root, 'reports', 'thesis', 'benchmark-' + new Date().toISOString().replaceAll(':', '-'));
const limitArg = process.argv.indexOf('--limit');
const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : 30;
if (!Number.isInteger(limit) || limit < 1 || limit > 30) throw new Error('--limit must be 1..30');
const normalize = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replaceAll('đ', 'd').replaceAll('Đ', 'D').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const round = number => Math.round(number * 1000) / 1000;
const percentile = (rows, p) => rows.length ? [...rows].sort((a, b) => a - b)[Math.ceil(p * rows.length) - 1] : null;
const average = rows => rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : null;
const raw = { runId, startedAt: new Date().toISOString(), measurements: [], quality: [], providerErrors: [] };
const config = (prefix = process.env.REDIS_KEY_PREFIX || '') => ({
  get(key) {
    return { 'openai.apiKey': process.env.OPENAI_API_KEY,
      'openai.model': process.env.OPENAI_MODEL || 'gpt-6-luna',
      'openai.embeddingModel': process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small' }[key];
  },
  getOrThrow(key) {
    if (key === 'redis') return { enabled: true, url: process.env.REDIS_URL || 'redis://localhost:6379', keyPrefix: prefix,
      db: Number(process.env.REDIS_DB || 0), defaultTtlSeconds: 300, connectTimeoutMs: 5000 };
    if (key === 'auth.secret') return 'isolated-benchmark-signing-key-' + runId;
    throw new Error('Unknown configuration: ' + key);
  },
});

function providerInstrumentation(ai, embedding) {
  for (const [service, method] of [[ai, 'rankWithOpenAI'], [embedding, 'embedText'], [embedding, 'searchWithRedisSearch']]) {
    const original = service[method].bind(service);
    service[method] = async (...args) => {
      const start = performance.now();
      const result = await original(...args);
      const current = storage.getStore();
      if (current) current.stages.push({ stage: method, durationMs: round(performance.now() - start),
        successful: method === 'embedText' ? Boolean(result?.length) : Boolean(result?.length),
        ...(method === 'rankWithOpenAI' ? { input: args[0], output: result } : {}) });
      return result;
    };
  }
  // Record provider failures without URLs, keys, prompts or patient records.
  for (const [client, name] of [[ai.aiClient, 'ranking'], [embedding.aiClient, 'embedding']]) {
    if (!client) continue;
    const resource = name === 'ranking' ? client.responses : client.embeddings;
    for (const method of ['create']) {
      const original = resource[method].bind(resource);
      resource[method] = async (...args) => {
        try { return await original(...args); }
        catch (error) {
          const message = String(error.message || '');
          const category = /fetch failed|ENOTFOUND|ECONN|EACCES|EPERM/i.test(message) ? 'NETWORK'
            : /429|quota|RESOURCE_EXHAUSTED/i.test(message) ? 'QUOTA'
            : /timeout|abort|timed out/i.test(message) ? 'TIMEOUT' : 'PROVIDER';
          let details = [];
          try { details = JSON.parse(message).error?.details || []; } catch {}
          raw.providerErrors.push({ caseId: storage.getStore()?.caseId, provider: name, category,
            status: error.status || error.code || null,
            quotaIds: details.flatMap(detail => (detail.violations || []).map(item => item.quotaId)),
            retrySeconds: Number(details.find(detail => detail.retryDelay)?.retryDelay?.replace('s', '') || 0),
            message: message.replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED]').replace(/AIza[A-Za-z0-9_-]+/g, '[REDACTED]').replace(/https?:\/\/[^\s\"]+/g, '[URL]').slice(0, 600) });
          throw error;
        }
      };
    }
  }
}

function qualityScores(items, relevantIds) {
  const top = items.slice(0, 3), hits = top.map(item => relevantIds.has(item.packageId) ? 1 : 0);
  const dcg = hits.reduce((sum, hit, index) => sum + hit / Math.log2(index + 2), 0);
  const ideal = Array.from({ length: Math.min(3, relevantIds.size) }, (_, index) => 1 / Math.log2(index + 2)).reduce((a, b) => a + b, 0);
  return { precision3: hits.reduce((a, b) => a + b, 0) / 3, hit3: hits.includes(1) ? 1 : 0,
    mrr3: hits.includes(1) ? 1 / (hits.indexOf(1) + 1) : 0, ndcg3: ideal ? dcg / ideal : null };
}

async function measured(caseId, scenario, work) {
  const trace = { caseId, scenario, stages: [] };
  return storage.run(trace, async () => {
    const start = performance.now();
    try {
      const result = await work();
      Object.assign(trace, { ok: true, durationMs: round(performance.now() - start),
        fromCache: result.fromCache, packageCount: result.packages?.length || 0,
        aiCalls: trace.stages.filter(item => item.stage === 'rankWithOpenAI').length,
        aiSuccess: trace.stages.filter(item => item.stage === 'rankWithOpenAI' && item.successful).length });
      raw.measurements.push(trace);
      return { result, trace };
    } catch (error) {
      Object.assign(trace, { ok: false, durationMs: round(performance.now() - start), error: error.name });
      raw.measurements.push(trace);
      throw error;
    }
  });
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const prisma = new PrismaService();
  const redis = new RedisService(config(`benchmark:${runId}:`));
  const vectors = new RedisService(config());
  let owner;
  const save = () => fs.writeFileSync(path.join(output, 'raw-results.json'), JSON.stringify(raw, null, 2));
  try {
    await Promise.all([prisma.$connect(), redis.onModuleInit(), vectors.onModuleInit()]);
    const telemetry = new BehaviorTelemetryService(prisma, redis);
    const embedding = new EmbeddingService(config(), vectors);
    const retrieval = new CandidateRetrievalService(prisma, embedding, telemetry);
    const ai = new AiRankingService(config());
    providerInstrumentation(ai, embedding);
    const analytics = new SearchAnalyticsService(prisma, config());
    const recommendations = new RecommendationService(prisma, redis, telemetry, retrieval, ai, {}, analytics);
    const catalog = await retrieval.loadActivePackages();
    if (!catalog.length) throw new Error('No active deployed packages');
    const { TEST_CASES, buildEvaluationLabels } = await import(pathToFileURL(path.join(root, 'scripts/evaluate-accuracy.mjs')).href);
    const cases = TEST_CASES.slice(0, limit);
    raw.evaluationLabels = buildEvaluationLabels(catalog);
    const labelsById = new Map(raw.evaluationLabels.map(item => [item.packageId, item.specialtyNames]));
    const isRelevant = (pkg, tc) => labelsById.get(pkg.id).some(label => tc.expectedSpecialties.some(name => normalize(name) === normalize(label)));
    raw.environment = { platform: os.platform(), release: os.release(), cpu: os.cpus()[0]?.model,
      logicalCpus: os.cpus().length, totalRamGb: round(os.totalmem() / 1024 ** 3), node: process.version,
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), workingTreeMayBeModified: true,
      provider: 'OpenAI', embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
      vectorIndex: embedding.vectorIndexName, model: ai.modelName, rankingTimeoutMs: ai.AI_TIMEOUT_MS, activeCatalogCount: catalog.length,
      allPackageCount: await prisma.servicePackage.count(), measurementLevel: 'service calls; no HTTP/browser overhead',
      candidateLimit: TELEMETRY_CONFIG.CANDIDATE_POOL_TARGET, sourceResultLimit: TELEMETRY_CONFIG.SOURCE_PACKAGES_LIMIT,
      finalResultLimit: TELEMETRY_CONFIG.HOME_FINAL_PACKAGES_LIMIT, labelVersion: 'package-taxonomy-v2',
      labelHash: createHash('sha256').update(JSON.stringify(raw.evaluationLabels)).digest('hex'),
      labels: 'Synthetic cases; DB specialty plus explicit content-based package taxonomy annotations; NOT clinician-reviewed labels',
      corpusHash: createHash('sha256').update(JSON.stringify(catalog)).digest('hex') };
    raw.catalog = catalog.map(pkg => ({ id: pkg.id, code: pkg.code, name: pkg.name, specialtyId: pkg.specialtyId,
      specialtyName: pkg.specialty?.name, targetGender: pkg.targetGender, minAge: pkg.minAge, maxAge: pkg.maxAge, isPediatric: pkg.isPediatric }));
    owner = await prisma.user.create({ data: { fullName: 'Benchmark isolated ' + runId }, select: { id: true } });
    const fixtures = [];
    for (const tc of cases) {
      const dateOfBirth = new Date();
      dateOfBirth.setUTCFullYear(dateOfBirth.getUTCFullYear() - tc.profile.age);
      const profile = await prisma.patientProfile.create({ data: { accountId: owner.id, fullName: 'Benchmark ' + tc.id,
        dateOfBirth, gender: tc.profile.gender, height: 170, weight: tc.profile.bmi * 1.7 ** 2,
        medicalHistory: tc.profile.medicalHistory, allergies: tc.profile.allergies }, select: { id: true } });
      fixtures.push({ tc, profileId: profile.id });
    }
    // Warm DB/connection pools only; no recommendation, AI or rank cache warmup.
    for (let i = 0; i < 5; i++) await retrieval.loadActivePackages();
    for (const { tc, profileId } of fixtures) {
      const { result, trace } = await measured(tc.id, 'PROFILE_COLD', () => recommendations.getHomeRecommendations({ profileId }, owner.id));
      const context = await retrieval.getProfileContext(profileId);
      const relevant = new Set(catalog.filter(pkg => retrieval.isPackageEligibleForProfile(pkg, context)
        && isRelevant(pkg, tc)).map(pkg => pkg.id));
      const ranking = trace.stages.find(stage => stage.stage === 'rankWithOpenAI');
      const pool = (ranking?.input?.candidates || []).map(item => ({ pkg: catalog.find(pkg => pkg.id === item.id), origin: 'PROFILE' }));
      const baseline = ai.rankWithRules(pool, context.medicalHistory).slice(0, TELEMETRY_CONFIG.SOURCE_PACKAGES_LIMIT);
      const ranked = ranking?.output || [];
      const candidateRelevant = new Set(pool.filter(item => relevant.has(item.pkg.id)).map(item => item.pkg.id));
      raw.quality.push({ caseId: tc.id, category: tc.category, profile: tc.profile,
        expectedSpecialties: tc.expectedSpecialties, followUpHistoryNotSimulated: Boolean(tc.isFollowUpTest),
        relevantIds: [...relevant], candidateIds: pool.map(item => item.pkg.id), candidateRelevantCount: candidateRelevant.size,
        aiSuccessful: ranked.length > 0, aiRanking: ranked, baseline, finalPackages: result.packages,
        aiMetrics: ranked.length && relevant.size ? qualityScores(ranked, relevant) : null,
        baselineMetrics: relevant.size ? qualityScores(baseline, relevant) : null,
        finalMetrics: relevant.size ? qualityScores(result.packages, relevant) : null,
        candidateNdcgAi: ranked.length && candidateRelevant.size ? qualityScores(ranked, candidateRelevant).ndcg3 : null,
        candidateNdcgBaseline: candidateRelevant.size ? qualityScores(baseline, candidateRelevant).ndcg3 : null,
        finalConstraintViolations: result.packages.filter(item => !retrieval.isPackageEligibleForProfile(catalog.find(pkg => pkg.id === item.packageId), context)).length,
      });
      console.log(`${tc.id}: ${trace.durationMs}ms; AI=${trace.aiSuccess}/${trace.aiCalls}; packages=${result.packages.length}`);
      save();
    }
    const behaviorFixtures = fixtures.filter((_, index) => index % 3 === 0).slice(0, 10);
    for (const { tc } of behaviorFixtures) {
      const sessionId = 'bench_' + runId + '_' + tc.id;
      await redis.getClient().hset('rec:guest_interest:' + sessionId,
        'last_search_query', tc.profile.medicalHistory, 'last_search_at', String(Date.now()));
      await redis.getClient().expire('rec:guest_interest:' + sessionId, 3600);
      const { result, trace } = await measured('BEH-' + tc.id, 'BEHAVIOR_COLD', () => recommendations.getHomeRecommendations({ sessionId }));
      const ranking = trace.stages.find(stage => stage.stage === 'rankWithOpenAI');
      const relevant = new Set(catalog.filter(pkg => isRelevant(pkg, tc)).map(pkg => pkg.id));
      const pool = (ranking?.input?.candidates || []).map(item => ({ pkg: catalog.find(pkg => pkg.id === item.id), origin: 'BEHAVIOR', behaviorSourceType: item.behaviorSourceType }));
      const ranked = ranking?.output || [];
      const baseline = ai.rankWithRules(pool).slice(0, TELEMETRY_CONFIG.SOURCE_PACKAGES_LIMIT);
      raw.quality.push({ caseId: 'BEH-' + tc.id, category: tc.category, expectedSpecialties: tc.expectedSpecialties,
        relevantIds: [...relevant], candidateIds: pool.map(item => item.pkg.id), aiSuccessful: ranked.length > 0,
        aiRanking: ranked, baseline, finalPackages: result.packages,
        aiMetrics: ranked.length && relevant.size ? qualityScores(ranked, relevant) : null,
        baselineMetrics: relevant.size ? qualityScores(baseline, relevant) : null,
        finalMetrics: relevant.size ? qualityScores(result.packages, relevant) : null });
      console.log(`BEH-${tc.id}: ${trace.durationMs}ms; AI=${trace.aiSuccess}/${trace.aiCalls}`);
      save();
    }
    // Five calls excluded as explicit warmup; then fixed-size cached workloads.
    for (let i = 0; i < 5; i++) await recommendations.getHomeRecommendations({ profileId: fixtures[0].profileId }, owner.id);
    raw.workloads = [];
    for (const concurrency of [1, 5, 10]) {
      const start = performance.now();
      let next = 0;
      await Promise.all(Array.from({ length: concurrency }, async () => {
        while (next < 100) {
          const index = next++;
          await measured('CACHE-' + index, 'PROFILE_CACHE_C' + concurrency,
            () => recommendations.getHomeRecommendations({ profileId: fixtures[0].profileId }, owner.id));
        }
      }));
      raw.workloads.push({ scenario: 'PROFILE_CACHE_C' + concurrency, count: 100, concurrency,
        wallMs: round(performance.now() - start), rps: round(100000 / (performance.now() - start)) });
      console.log(`Cache concurrency ${concurrency}: complete`);
    }
    for (let i = 0; i < 30; i++) await measured('DEFAULT-' + i, 'NO_CONTEXT', () => recommendations.getHomeRecommendations({}));
    const fallbackAI = new AiRankingService({ get: () => undefined });
    fallbackAI.aiClient = null;
    const fallback = new RecommendationService(prisma, redis, telemetry, retrieval, fallbackAI, {}, analytics);
    for (let i = 0; i < 10; i++) {
      await redis.delete(TELEMETRY_CONFIG.CACHE_PREFIX + ':profile:' + fixtures[i % fixtures.length].profileId);
      await measured('FALLBACK-' + i, 'FORCED_AI_UNAVAILABLE', () => fallback.getHomeRecommendations({ profileId: fixtures[i % fixtures.length].profileId }, owner.id));
    }
    raw.summary = [...new Set(raw.measurements.map(item => item.scenario))].map(scenario => {
      const rows = raw.measurements.filter(item => item.scenario === scenario), times = rows.map(item => item.durationMs);
      return { scenario, count: rows.length, errors: rows.filter(item => !item.ok).length,
        aiCalls: rows.reduce((sum, item) => sum + (item.aiCalls || 0), 0), aiSuccess: rows.reduce((sum, item) => sum + (item.aiSuccess || 0), 0),
        cacheHits: rows.filter(item => item.fromCache).length, meanMs: round(average(times)), p50Ms: round(percentile(times, .5)), p95Ms: round(percentile(times, .95)) };
    });
    raw.completedAt = new Date().toISOString();
    save();
  } finally {
    if (owner) {
      await prisma.patientProfile.deleteMany({ where: { accountId: owner.id } });
      await prisma.user.delete({ where: { id: owner.id } });
      raw.fixtureCleanup = 'completed';
    }
    if (redis.isEnabled()) {
      const client = redis.getClient().duplicate({ keyPrefix: '' });
      let cursor = '0';
      do {
        const [next, keys] = await client.scan(cursor, 'MATCH', `benchmark:${runId}:*`, 'COUNT', 100);
        cursor = next;
        if (keys.length) await client.del(...keys);
      } while (cursor !== '0');
      await client.quit();
    }
    await Promise.all([redis.onModuleDestroy(), vectors.onModuleDestroy(), prisma.onModuleDestroy()]);
    save();
    console.log('REPORT=' + output);
  }
}
async function recoverRanking(sourceFile) {
  fs.mkdirSync(output, { recursive: true });
  const original = JSON.parse(fs.readFileSync(path.resolve(sourceFile), 'utf8'));
  const ai = new AiRankingService(config());
  if (original.environment?.model !== ai.modelName || original.environment?.candidateLimit !== TELEMETRY_CONFIG.CANDIDATE_POOL_TARGET || original.environment?.sourceResultLimit !== TELEMETRY_CONFIG.SOURCE_PACKAGES_LIMIT) {
    throw new Error('Recovery requires the same model and ranking limits; run a fresh benchmark after migration.');
  }
  providerInstrumentation(ai, new EmbeddingService(config(), { isEnabled: () => false }));
  raw.recoveryOf = path.resolve(sourceFile);
  raw.environment = { ...original.environment, measurementLevel: 'Ranking-only recovery on unchanged captured candidate pools; retrieval is not rerun' };
  const pending = original.quality.filter(row => !row.aiSuccessful && row.candidateIds.length > 0);
  let lastRequest = 0;
  for (const row of pending) {
    const input = original.measurements.find(item => item.caseId === row.caseId)?.stages.find(stage => stage.stage === 'rankWithOpenAI')?.input;
    if (!input) continue;
    let ranked = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      const wait = Math.max(0, 15000 - (Date.now() - lastRequest));
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      lastRequest = Date.now();
      const { result, trace } = await measured(row.caseId + '-retry-' + attempt, 'RANKING_RECOVERY', async () => ({ packages: await ai.rankWithOpenAI(input) }));
      ranked = result.packages;
      console.log(`Recovery ${row.caseId} attempt ${attempt}: AI=${ranked.length > 0}; ${trace.durationMs}ms`);
      fs.writeFileSync(path.join(output, 'raw-results.json'), JSON.stringify(raw, null, 2));
      if (ranked.length) break;
      const error = raw.providerErrors.at(-1);
      if (error?.category !== 'QUOTA') break;
      if (error.quotaIds?.some(id => /PerDay/.test(id))) {
        raw.stopReason = 'Daily provider quota exhausted; remaining cases are not measured.';
        raw.quotaEvidence = error;
        break;
      }
      const retrySeconds = error.retrySeconds || Number(error.message.match(/retry in ([\d.]+)s/)?.[1] || 30);
      console.log(`Quota wait: ${Math.ceil(retrySeconds) + 1}s`);
      await new Promise(resolve => setTimeout(resolve, (Math.ceil(retrySeconds) + 1) * 1000));
    }
    const relevant = new Set(row.relevantIds);
    raw.quality.push({ caseId: row.caseId, aiSuccessful: ranked.length > 0, aiRanking: ranked,
      aiMetrics: ranked.length && relevant.size ? qualityScores(ranked, relevant) : null });
    fs.writeFileSync(path.join(output, 'raw-results.json'), JSON.stringify(raw, null, 2));
    if (raw.stopReason) break;
  }
  raw.completedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output, 'raw-results.json'), JSON.stringify(raw, null, 2));
  console.log('REPORT=' + output);
}
const recoveryIndex = process.argv.indexOf('--recover');
const action = recoveryIndex >= 0 ? () => recoverRanking(process.argv[recoveryIndex + 1]) : main;
action().catch(error => { console.error(error.name + ': ' + error.message); process.exitCode = 1; });
