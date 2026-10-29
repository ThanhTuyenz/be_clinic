// Preview by default; --apply repairs only packages still carrying the legacy seed symptoms.
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import Redis from 'ioredis';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: process.env.ENV_FILE || '.env.development', override: true, quiet: true });
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL }) });
const legacySymptoms = ['Kiểm tra sức khỏe định kỳ', 'Mệt mỏi suy nhược', 'Sụt cân không rõ nguyên nhân', 'Đau đầu mất ngủ'];
const legacyDescription = 'Khám lâm sàng toàn diện các cơ quan nội khoa, đánh giá chỉ số sinh hiệu và tầm soát sớm các bệnh lý lối sống.';
const legacyFollowup = 'Đánh giá lại các chỉ số xét nghiệm bất thường, theo dõi tiến triển sức khỏe định kỳ và tư vấn cải thiện.';
const legacyNotes = 'Nhịn ăn sáng ít nhất 6-8 tiếng để lấy máu xét nghiệm đường huyết, mỡ máu và men gan. Không uống nước ngọt, sữa hay cà phê.';
let redis;

try {
  const packages = await prisma.servicePackage.findMany({
    where: { code: { startsWith: 'CONSULT-' }, symptoms: { equals: legacySymptoms }, specialtyId: { not: null } },
    select: { id: true, code: true, name: true, symptoms: true, description: true, notes: true,
      specialty: { select: { name: true, slug: true, symptoms: true, description: true } } },
    orderBy: { code: 'asc' },
  });
  const changes = packages.filter(pkg => pkg.specialty?.symptoms.length).map(pkg => {
    const data = { symptoms: pkg.specialty.symptoms };
    if (!['noi-tong-quat', 'tong_quat'].includes(pkg.specialty.slug)) {
      if (pkg.description === legacyDescription) data.description = pkg.specialty.description || `Khám chuyên khoa ${pkg.specialty.name}.`;
      if (pkg.description === legacyFollowup) data.description = `Theo dõi sau lần khám trước tại chuyên khoa ${pkg.specialty.name}. ${pkg.specialty.description || ''}`.trim();
      if (pkg.notes?.includes(legacyNotes)) data.notes = pkg.notes.replace(legacyNotes, 'Mang theo hồ sơ và kết quả khám trước đây (nếu có).');
    }
    return { pkg, data };
  });
  console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply' : 'preview', count: changes.length,
    changes: changes.map(({ pkg, data }) => ({ code: pkg.code, specialty: pkg.specialty.name, ...data })) }, null, 2));

  if (process.argv.includes('--apply') && changes.length) {
    fs.mkdirSync('.tmp', { recursive: true });
    const backup = path.join('.tmp', `specialty-packages-before-${Date.now()}.json`);
    fs.writeFileSync(backup, JSON.stringify(packages, null, 2));
    await prisma.$transaction(async tx => {
      for (const { pkg, data } of changes) {
        const result = await tx.servicePackage.updateMany({
          where: { id: pkg.id, symptoms: { equals: pkg.symptoms }, description: pkg.description, notes: pkg.notes }, data,
        });
        if (result.count !== 1) throw new Error(`Package changed during repair: ${pkg.code}`);
      }
    });
    if (process.env.REDIS_ENABLED === 'true') {
      redis = new Redis(process.env.REDIS_URL, { db: Number(process.env.REDIS_DB || 0), lazyConnect: true,
        connectTimeout: 5000, maxRetriesPerRequest: 1, retryStrategy: () => null });
      await redis.connect();
      const prefix = process.env.REDIS_KEY_PREFIX ?? 'vitacare:';
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}rec:cache:search_candidates:*`, 'COUNT', 100);
        cursor = next;
        if (keys.length) await redis.del(...keys);
      } while (cursor !== '0');
    }
    console.log(`Updated ${changes.length} packages. Backup: ${backup}. Run npm run redis:search:sync to refresh embeddings.`);
  }
} catch (error) {
  console.error('Catalog repair failed:', error.code || error.name);
  process.exitCode = 1;
} finally {
  if (redis) redis.disconnect();
  await prisma.$disconnect();
}
