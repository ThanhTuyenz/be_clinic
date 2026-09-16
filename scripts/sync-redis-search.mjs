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
const INDEX_NAME = 'idx:packages_vss';
const VECTOR_DIM = 3072; // Gemini Embedding default output dimension (3072 floats)

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

async function ensureRedisSearchIndex() {
  try {
    const modules = await redis.call('MODULE', 'LIST');
    const hasSearch = Array.isArray(modules) && modules.some((m) => Array.isArray(m) && m.includes('search'));
    if (!hasSearch) {
      console.warn('⚠️ Module RediSearch không tồn tại trong Redis instance này.');
      return false;
    }

    try {
      await redis.call('FT.INFO', INDEX_NAME);
      console.log(`✅ Index RediSearch "${INDEX_NAME}" đã tồn tại.`);
      return true;
    } catch (err) {
      // Nếu index chưa có, tạo mới
      console.log(`🔧 Đang khởi tạo Index RediSearch HNSW "${INDEX_NAME}"...`);
      const fullPrefix = `${redisPrefix}pkg_vss:`;
      await redis.call(
        'FT.CREATE', INDEX_NAME,
        'ON', 'HASH',
        'PREFIX', '1', fullPrefix,
        'SCHEMA',
        'packageId', 'TAG',
        'code', 'TAG',
        'name', 'TEXT',
        'specialtyName', 'TEXT',
        'price', 'NUMERIC',
        'vector', 'VECTOR', 'HNSW', '6',
        'TYPE', 'FLOAT32',
        'DIM', String(VECTOR_DIM),
        'DISTANCE_METRIC', 'COSINE'
      );
      console.log(`✅ Đã tạo thành công Index RediSearch HNSW "${INDEX_NAME}" (Prefix: ${fullPrefix}, Dim: ${VECTOR_DIM})!`);
      return true;
    }
  } catch (err) {
    console.error(`❌ Lỗi khởi tạo index RediSearch: ${err.message}`);
    return false;
  }
}

async function main() {
  console.log('🚀 Bắt đầu tiến trình kiểm tra & nạp Vector vào RedisSearch (HNSW)...\n');

  try {
    await redis.connect();
    console.log('✅ Đã kết nối Redis thành công.');
  } catch (err) {
    console.error('❌ Không thể kết nối Redis:', err.message);
    process.exit(1);
  }

  const searchReady = await ensureRedisSearchIndex();
  if (!searchReady) {
    console.error('❌ Không thể cấu hình RediSearch. Dừng tiến trình.');
    await redis.quit();
    process.exit(1);
  }

  // Lấy toàn bộ gói khám đang hoạt động
  const packages = await prisma.servicePackage.findMany({
    where: { isActive: true },
    include: { specialty: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`📋 Tìm thấy tổng cộng: ${packages.length} gói khám trong cơ sở dữ liệu.\n`);

  let syncedCount = 0;
  let cachedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < packages.length; i++) {
    const pkg = packages[i];
    const hashKey = `pkg_vss:${pkg.id}`;
    const legacyRedisKey = `vector:pkg:${pkg.id}`;

    let vector = null;

    // 1. Kiểm tra xem Hash RediSearch pkg_vss đã có vector nhị phân hợp lệ chưa
    const existingBuf = await redis.hgetBuffer(hashKey, 'vector').catch(() => null);
    if (existingBuf && existingBuf.length === VECTOR_DIM * 4) {
      cachedCount++;
      // Xóa dọn dẹp legacy key nếu còn sót
      await redis.del(legacyRedisKey).catch(() => {});
      process.stdout.write(`⚡ [${i + 1}/${packages.length}] Đã có sẵn trong HNSW Hash: "${pkg.name}"\n`);
      continue;
    }

    // 2. Nếu hash chưa có, kiểm tra legacy cache cũ để tận dụng (nếu có)
    const existingStr = await redis.get(legacyRedisKey).catch(() => null);
    if (existingStr) {
      try {
        const parsed = JSON.parse(existingStr);
        if (Array.isArray(parsed) && parsed.length === VECTOR_DIM) {
          vector = parsed;
        }
      } catch (e) { }
    }

    // 3. Nếu chưa có vector, gọi sinh mới qua Gemini
    if (!vector) {
      const specialty = pkg.specialty?.name ? `Chuyên khoa: ${pkg.specialty.name}. ` : '';
      const desc = pkg.description ? `Mô tả & Chỉ định: ${pkg.description.slice(0, 300)}` : '';
      const text = `Gói khám: ${pkg.name}. ${specialty}${desc}`.trim();

      try {
        vector = await embedText(text);
      } catch (err) {
        failedCount++;
        console.error(`❌ [${i + 1}/${packages.length}] Lỗi sinh vector "${pkg.name}": ${err.message}`);
        continue;
      }
      await delay(120);
    }

    if (vector && vector.length === VECTOR_DIM) {
      // 4. Chuyển float array thành nhị phân Buffer chuẩn Float32
      const float32 = new Float32Array(vector);
      const vectorBuffer = Buffer.from(float32.buffer);

      // 5. Lưu DUY NHẤT vào Hash RediSearch HNSW (key: pkg_vss:<id>)
      await redis.hset(
        hashKey,
        'packageId', pkg.id,
        'code', pkg.code,
        'name', pkg.name,
        'specialtyName', pkg.specialty?.name || 'Đa khoa',
        'price', String(pkg.price),
        'vector', vectorBuffer
      );

      // Xóa bỏ legacy key để giải phóng RAM Redis
      await redis.del(legacyRedisKey).catch(() => {});

      syncedCount++;
      process.stdout.write(`✅ [${i + 1}/${packages.length}] HNSW Indexed: "${pkg.name}" (${pkg.code})\n`);
    } else {
      failedCount++;
      process.stdout.write(`⚠️ [${i + 1}/${packages.length}] Bỏ qua gói không hợp lệ: "${pkg.name}"\n`);
    }
  }

  console.log('\n========================================');
  console.log(`🎉 HOÀN TẤT ĐỒNG BỘ REDISSEARCH (HNSW):`);
  console.log(`   - Tổng số gói khám:       ${packages.length}`);
  console.log(`   - Tái sử dụng vector cũ:  ${cachedCount} gói`);
  console.log(`   - Đã nạp vào RediSearch:  ${syncedCount} gói`);
  console.log(`   - Lỗi / Bỏ qua:           ${failedCount} gói`);
  console.log('========================================\n');

  // 5. Test thử một truy vấn KNN mẫu để đo tốc độ
  if (syncedCount > 0) {
    console.log('⚡ Đang thực hiện truy vấn KNN thử nghiệm trực tiếp trên RedisSearch...');
    const testVector = new Float32Array(VECTOR_DIM).fill(0.01);
    const testBuffer = Buffer.from(testVector.buffer);

    const tStart = performance.now();
    const query = '*=>[KNN 5 @vector $BLOB AS score]';
    const rawResult = await redis.call(
      'FT.SEARCH', INDEX_NAME,
      query,
      'PARAMS', '2', 'BLOB', testBuffer,
      'SORTBY', 'score', 'ASC',
      'RETURN', '3', 'packageId', 'name', 'score',
      'DIALECT', '2'
    );
    const tEnd = performance.now();
    const duration = (tEnd - tStart).toFixed(3);

    console.log(`⚡ Kết quả truy vấn KNN trên RAM hoàn tất trong: ${duration} ms!`);
    console.log(`   - Tổng số kết quả khớp: ${rawResult[0]}`);
    console.log('   - Top gói mẫu trả về từ RedisSearch HNSW:');
    for (let j = 1; j < rawResult.length && j <= 6; j += 2) {
      const key = rawResult[j];
      const fields = rawResult[j + 1];
      let name = '';
      let score = '';
      for (let k = 0; k < fields.length; k += 2) {
        if (fields[k] === 'name') name = fields[k + 1];
        if (fields[k] === 'score') score = fields[k + 1];
      }
      console.log(`     • ${key} -> "${name}" (Cosine Distance: ${score})`);
    }
  }

  await redis.quit();
  await prisma.$disconnect();
  await pool.end();
}

main().catch((err) => {
  console.error('❌ Lỗi:', err);
  process.exit(1);
});
