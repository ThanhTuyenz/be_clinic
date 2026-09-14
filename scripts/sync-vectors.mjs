import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'node:path';
import Redis from 'ioredis';
import { GoogleGenAI } from '@google/genai';

const envFile = process.env.ENV_FILE || '.env.development';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), envFile), override: true });

// 1. Kết nối PostgreSQL
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('❌ Thiếu DATABASE_URL trong biến môi trường!');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// 2. Kết nối Redis
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redisPrefix = process.env.REDIS_KEY_PREFIX || '';
const redis = new Redis(redisUrl, {
  keyPrefix: redisPrefix,
  lazyConnect: true,
});

// 3. Khởi tạo Google GenAI
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('❌ Thiếu GEMINI_API_KEY trong biến môi trường!');
  process.exit(1);
}
const ai = new GoogleGenAI({ apiKey });
const embeddingModel = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';
const VECTOR_TTL_SECONDS = 30 * 24 * 3600; // 30 ngày

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function embedText(text) {
  const models = [embeddingModel, 'gemini-embedding-001', 'embedding-001'];
  for (const model of [...new Set(models)]) {
    try {
      const response = await ai.models.embedContent({
        model,
        contents: text.trim().slice(0, 2048),
      });
      const values = response?.embedding?.values || response?.embeddings?.[0]?.values;
      if (Array.isArray(values) && values.length > 0) {
        return values;
      }
    } catch (err) {
      if (err?.message?.includes('404') || err?.message?.includes('not found')) {
        continue;
      }
      throw err;
    }
  }
  return null;
}

async function main() {
  console.log('🚀 Bắt đầu tiến trình kiểm tra & đồng bộ Vector Embedding vào Redis...\n');

  try {
    await redis.connect();
    console.log('✅ Đã kết nối Redis thành công.');
  } catch (err) {
    console.error('❌ Không thể kết nối Redis:', err.message);
    process.exit(1);
  }

  // Lấy toàn bộ gói khám đang hoạt động
  const packages = await prisma.servicePackage.findMany({
    where: { isActive: true },
    include: { specialty: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`📋 Tìm thấy tổng cộng: ${packages.length} gói khám trong cơ sở dữ liệu.\n`);

  let skippedCount = 0;
  let syncedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < packages.length; i++) {
    const pkg = packages[i];
    const redisKey = `vector:pkg:${pkg.id}`;

    // Kiểm tra xem đã có trong Redis chưa
    const existing = await redis.get(redisKey);
    if (existing) {
      skippedCount++;
      process.stdout.write(`⏩ [${i + 1}/${packages.length}] Đã có trong Redis: "${pkg.name}" (${pkg.code})\n`);
      continue;
    }

    // Nếu chưa có, xây dựng văn bản ngữ nghĩa y khoa
    const specialty = pkg.specialty?.name ? `Chuyên khoa: ${pkg.specialty.name}. ` : '';
    const desc = pkg.description ? `Mô tả & Chỉ định: ${pkg.description.slice(0, 300)}` : '';
    const text = `Gói khám: ${pkg.name}. ${specialty}${desc}`.trim();

    try {
      const vector = await embedText(text);
      if (vector && Array.isArray(vector)) {
        await redis.set(redisKey, JSON.stringify(vector), 'EX', VECTOR_TTL_SECONDS);
        syncedCount++;
        process.stdout.write(`✅ [${i + 1}/${packages.length}] Đã sinh & lưu vector (${vector.length} chiều): "${pkg.name}"\n`);
      } else {
        failedCount++;
        process.stdout.write(`⚠️ [${i + 1}/${packages.length}] Không lấy được vector: "${pkg.name}"\n`);
      }
    } catch (err) {
      failedCount++;
      process.stdout.write(`❌ [${i + 1}/${packages.length}] Lỗi khi sinh vector "${pkg.name}": ${err.message}\n`);
    }

    // Delay 120ms giữa các request để giữ an toàn tuyệt đối với Rate Limit
    await delay(120);
  }

  console.log('\n========================================');
  console.log(`🎉 HOÀN TẤT ĐỒNG BỘ VECTOR EMBEDDING:`);
  console.log(`   - Tổng số gói khám:    ${packages.length}`);
  console.log(`   - Đã có sẵn (Bỏ qua):  ${skippedCount} gói (0đ token)`);
  console.log(`   - Đã sinh mới & lưu:   ${syncedCount} gói`);
  console.log(`   - Thất bại / Lỗi:      ${failedCount} gói`);
  console.log('========================================\n');

  await redis.quit();
  await prisma.$disconnect();
  await pool.end();
}

main().catch((err) => {
  console.error('❌ Lỗi tiến trình đồng bộ:', err);
  process.exit(1);
});
