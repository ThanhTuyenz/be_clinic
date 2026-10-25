// Diagnose saved benchmark misses against the current catalog/index without changing them.
if (!process.argv[2]) {
  console.error('Usage: node scripts/audit-recommendation-retrieval.cjs <path-to-raw-results.json>');
  process.exit(1);
}
require('ts-node/register/transpile-only');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { createHash } = require('node:crypto');
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
const { ConfigService } = require('@nestjs/config');
const { Logger } = require('@nestjs/common');
Logger.overrideLogger(false);
const { PrismaService } = require('../src/infrastructure/database/prisma/prisma.service.ts');
const { RedisService } = require('../src/infrastructure/redis/redis.service.ts');
const { EmbeddingService, mapPackageForRetrieval } = require('../src/infrastructure/embedding/embedding.service.ts');
const { CandidateRetrievalService } = require('../src/modules/recommendations/services/candidate-retrieval.service.ts');
const redisFactory = require('../src/infrastructure/redis/redis.config.ts').default;
const openaiFactory = require('../src/config/openai.config.ts').default;
const config = new ConfigService({ redis: redisFactory(), openai: openaiFactory() });
const sourceFile = path.resolve(process.argv[2]);
const original = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
const output = path.join(path.dirname(sourceFile), 'retrieval-audit.json');
const candidateLimit = original.environment.candidateLimit || 8;
const prisma = new PrismaService();
const redis = new RedisService(config);
const embedding = new EmbeddingService(config, redis);
const retrieval = new CandidateRetrievalService(prisma, embedding, {});
const report = { source: sourceFile, auditedAt: new Date().toISOString(), mode: 'Current index replay, new query embeddings; original benchmark remains unchanged', cases: [] };
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));

async function main() {
  try {
    if (config.get('openai.embeddingModel') !== original.environment.embeddingModel) throw new Error('Embedding model changed since benchmark');
    if (original.environment.vectorIndex !== embedding.vectorIndexName) throw new Error('Index version changed; audit a benchmark measured with the current index.');
    await redis.onModuleInit();
    const catalog = await retrieval.loadActivePackages();
    report.catalogCount = catalog.length;
    report.catalogIdsUnchanged = catalog.length === original.catalog.length && catalog.every(pkg => original.catalog.some(row => row.id === pkg.id && row.specialtyId === pkg.specialtyId));
    const client = redis.getClient();
    const indexed = new Map();
    let stale = 0;
    for (const pkg of catalog) {
      const key = embedding.vectorKeyPrefix + pkg.id;
      const buffer = await client.hgetBuffer(key, 'vector');
      if (buffer?.length === embedding.vectorDimensions * 4) indexed.set(pkg.id, Array.from(new Float32Array(Uint8Array.from(buffer).buffer)));
      const text = embedding.buildPackageEmbeddingText(mapPackageForRetrieval(pkg));
      if (await client.hget(key, 'fingerprint') !== createHash('sha256').update(text).digest('hex')) stale++;
    }
    report.index = { name: embedding.vectorIndexName, vectors: indexed.size, staleContentFingerprints: stale };
    report.packageMetadata = catalog.map(pkg => {
      const indexedText = embedding.buildPackageEmbeddingText(mapPackageForRetrieval(pkg));
      const runtimeText = embedding.buildPackageEmbeddingText(retrieval.mapToRetrievalPackage(pkg));
      return { id: pkg.id, name: pkg.name, specialtyId: pkg.specialtyId, specialty: pkg.specialty?.name || null,
        ownSymptoms: pkg.symptoms || [], specialtySymptoms: pkg.specialty?.symptoms || [],
        indexedText, retrievalMappingText: runtimeText, textsDiffer: indexedText !== runtimeText };
    });
    const failed = original.quality.filter(row => !row.caseId.startsWith('BEH-') && !row.followUpHistoryNotSimulated
      && !row.candidateIds.some(id => row.relevantIds.includes(id)));
    for (const row of failed) {
      const saved = original.measurements.find(item => item.caseId === row.caseId).stages.find(item => item.stage === 'rankWithOpenAI').input.profile;
      const context = { ...saved, profile: { id: 'audit-' + row.caseId }, recentlyCompletedPackageIds: [], followUpSpecialtyId: null };
      const related = catalog.filter(pkg => row.relevantIds.includes(pkg.id));
      const eligible = catalog.filter(pkg => retrieval.isPackageEligibleForProfile(pkg, context));
      const screening = eligible.filter(pkg => !retrieval.isFollowUpPackage(pkg));
      const candidates = screening.map(pkg => retrieval.mapToRetrievalPackage(pkg));
      const query = embedding.buildPatientEmbeddingText(saved);
      const vector = await embedding.embedText(query);
      if (!vector) throw new Error('Query embedding unavailable at ' + row.caseId);
      const full = screening.filter(pkg => indexed.has(pkg.id)).map(pkg => ({ id: pkg.id, code: pkg.code, name: pkg.name,
        specialty: pkg.specialty?.name || null, score: embedding.cosineSimilarity(vector, indexed.get(pkg.id)),
        relevant: row.relevantIds.includes(pkg.id) }))
        .sort((a, b) => b.score - a.score).map((item, index) => ({ ...item, rank: index + 1 }));
      const ann = await embedding.searchWithRedisSearch(vector, candidates, candidateLimit) || [];
      const relevantRanks = full.filter(item => item.relevant);
      const annRelevant = ann.filter(item => row.relevantIds.includes(item.package.id));
      const detail = { caseId: row.caseId, expectedSpecialties: row.expectedSpecialties, profile: saved,
        originalCandidateIds: row.candidateIds, relatedInCatalog: related.length,
        relatedAfterEligibility: related.filter(pkg => eligible.some(item => item.id === pkg.id)).length,
        relatedAfterFollowUpExclusion: relevantRanks.length, screeningCount: screening.length,
        excluded: related.filter(pkg => !screening.some(item => item.id === pkg.id)).map(pkg => ({ id: pkg.id, name: pkg.name,
          reason: !retrieval.isPackageEligibleForProfile(pkg, context) ? 'PROFILE_ELIGIBILITY' : 'FOLLOW_UP_WITHOUT_COMPLETED_HISTORY' })),
        bestRelevantRank: relevantRanks[0]?.rank || null, bestRelevantScore: relevantRanks[0]?.score || null,
        cutoffScore: full[candidateLimit - 1]?.score || null, candidateLimit, exactTopKSpecialties: [...new Set(full.slice(0, candidateLimit).map(item => item.specialty))],
        annRelevantCount: annRelevant.length, annIds: ann.map(item => item.package.id),
        annMatchesOriginalCandidates: ann.length === row.candidateIds.length && ann.every(item => row.candidateIds.includes(item.package.id)),
        annMatchesExactTopK: ann.length === Math.min(candidateLimit, full.length) && ann.every(item => full.slice(0, candidateLimit).some(exact => exact.id === item.package.id)),
        cause: !related.length ? 'NO_EXPECTED_SPECIALTY_IN_CATALOG' : !related.some(pkg => eligible.includes(pkg)) ? 'PROFILE_ELIGIBILITY'
          : !relevantRanks.length ? 'FOLLOW_UP_EXCLUSION' : relevantRanks[0].rank > candidateLimit ? 'VECTOR_RANK_BELOW_TOP_' + candidateLimit : !annRelevant.length ? 'ANN_MISSED_EXACT_NEIGHBOR' : 'NOT_REPRODUCED',
        rankedCandidates: full };
      report.cases.push(detail);
      save();
      console.log(JSON.stringify({ caseId: detail.caseId, cause: detail.cause, related: detail.relatedAfterFollowUpExclusion,
        bestRank: detail.bestRelevantRank, top8Specialties: detail.exactTopKSpecialties, annMatchesExact: detail.annMatchesExactTopK }));
    }
    report.completedAt = new Date().toISOString();
    report.causes = Object.fromEntries([...new Set(report.cases.map(row => row.cause))].map(cause => [cause, report.cases.filter(row => row.cause === cause).length]));
    report.labelLimitations = { packagesWithoutSpecialty: catalog.filter(pkg => !pkg.specialtyId).length,
      casesWithSpecialtyNullTopK: report.cases.filter(row => row.rankedCandidates.slice(0, candidateLimit).some(pkg => !pkg.specialty)).map(row => row.caseId),
      note: 'Specialty-only labels cannot assess specialty-null multi-service packages; clinical relevance is not adjudicated by this audit.' };
    save();
    console.log('AUDIT=' + output);
  } finally {
    await redis.onModuleDestroy();
    await prisma.onModuleDestroy();
  }
}
main().catch(error => {
  const reason = String(error.message || '').replace(/(?:https?|postgres(?:ql)?|redis):\/\/[^\s]+/g, '[URL]').replace(/sk-[A-Za-z0-9_-]+/g, '[KEY]');
  console.error('Audit failed:', error.status || error.code || error.name, reason.slice(0, 350));
  process.exitCode = 1;
});
