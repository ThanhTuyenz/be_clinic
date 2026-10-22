import { createRequire } from 'node:module';
import Module from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
require('ts-node/register/transpile-only');
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
const { PrismaService } = require('../src/infrastructure/database/prisma/prisma.service.ts');
const { RedisService } = require('../src/infrastructure/redis/redis.service.ts');
const { EmbeddingService, mapPackageForRetrieval } = require('../src/infrastructure/embedding/embedding.service.ts');
const redisFactory = require('../src/infrastructure/redis/redis.config.ts').default;
const openaiFactory = require('../src/config/openai.config.ts').default;
const config = new ConfigService({ redis: redisFactory(), openai: openaiFactory() });
const prisma = new PrismaService();
const redis = new RedisService(config);
const embedding = new EmbeddingService(config, redis);

try {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required');
  await redis.onModuleInit();
  await embedding.ensureVectorIndex();
  const rows = await prisma.servicePackage.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true, description: true, symptoms: true,
      price: true, durationMin: true, specialtyId: true, specialty: { select: { name: true, description: true, symptoms: true } } },
  });
  const packages = rows.map(mapPackageForRetrieval);
  let synced = 0;
  for (const pkg of packages) {
    if (await embedding.getOrComputePackageVector(pkg)) synced++;
  }
  if (synced !== packages.length) throw new Error(`Only ${synced}/${packages.length} vectors synchronized`);
  // Verify an actual package vector can retrieve its own package from the new index.
  const first = packages[0];
  if (first) {
    const vector = await embedding.getOrComputePackageVector(first);
    let hits = [];
    for (let attempt = 0; attempt < 10; attempt++) {
      hits = await embedding.searchWithRedisSearch(vector, packages, packages.length) || [];
      if (hits.some(hit => hit.package.id === first.id && hit.score > 0.99)) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (!hits.some(hit => hit.package.id === first.id && hit.score > 0.99)) {
      throw new Error('Vector index verification failed');
    }
  }
  console.log(JSON.stringify({ provider: 'OpenAI', index: embedding.vectorIndexName,
    dimensions: embedding.vectorDimensions, synchronized: synced, verified: true }));
} catch (error) {
  console.error('Vector synchronization failed:', error.name === 'ReplyError' ? error.message : error.status || error.code || error.name);
  process.exitCode = 1;
} finally {
  await redis.onModuleDestroy();
  await prisma.onModuleDestroy();
}
