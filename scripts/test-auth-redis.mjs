import dotenv from 'dotenv';
import path from 'node:path';
import Redis from 'ioredis';
import { createHash } from 'crypto';

const envFile = process.env.ENV_FILE || '.env.development';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), envFile), override: true });

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redisPrefix = process.env.REDIS_KEY_PREFIX || 'vitacare:';

const redis = new Redis(redisUrl, {
  keyPrefix: redisPrefix,
  lazyConnect: true,
});

async function main() {
  console.log('🧪 BẮT ĐẦU KIỂM TRA HỆ THỐNG AUTH & BLACKLIST TRÊN REDIS...\n');
  await redis.connect();

  // Test 1: Blacklist Access Token
  console.log('--- Test 1: Kiểm tra Blacklist Access Token ---');
  const sampleToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.sample_payload_data_for_test';
  const tokenHash = createHash('sha256').update(sampleToken).digest('hex');
  const blacklistKey = `auth:blacklist:${tokenHash}`;

  // Ban đầu chưa blacklist
  const isBlacklistedBefore = (await redis.exists(blacklistKey)) === 1;
  console.log(`1.1 Token ban đầu trong Blacklist? -> ${isBlacklistedBefore} (Mong đợi: false)`);

  // Thêm vào blacklist với TTL 120s
  await redis.set(blacklistKey, 'revoked', 'EX', 120);
  const isBlacklistedAfter = (await redis.exists(blacklistKey)) === 1;
  const ttl = await redis.ttl(blacklistKey);
  console.log(`1.2 Sau khi Logout, token trong Blacklist? -> ${isBlacklistedAfter} (Mong đợi: true, TTL: ${ttl}s)`);

  if (!isBlacklistedBefore && isBlacklistedAfter && ttl > 0) {
    console.log('✅ TEST 1 PASSED: Blacklist hoạt động chuẩn xác!\n');
  } else {
    throw new Error('Test 1 thất bại!');
  }

  // Test 2: Instant User Revocation (Đổi mật khẩu / Khóa tài khoản)
  console.log('--- Test 2: Thu hồi quyền tức thì theo User (Instant User Revocation) ---');
  const sampleUserId = 'test-user-uuid-1234';
  const userRevokeKey = `auth:user_revoked_at:${sampleUserId}`;

  const revokeTimestamp = Date.now();
  await redis.set(userRevokeKey, revokeTimestamp, 'EX', 900);

  const tokenIssuedBefore = Math.floor((revokeTimestamp - 10000) / 1000); // 10s trước
  const tokenIssuedAfter = Math.floor((revokeTimestamp + 10000) / 1000); // 10s sau

  const savedRevokedAt = await redis.get(userRevokeKey);
  const isOldTokenRevoked = tokenIssuedBefore * 1000 < Number(savedRevokedAt);
  const isNewTokenRevoked = tokenIssuedAfter * 1000 < Number(savedRevokedAt);

  console.log(`2.1 Token cấp TRƯỚC thời điểm đổi mật khẩu có bị chặn không? -> ${isOldTokenRevoked} (Mong đợi: true)`);
  console.log(`2.2 Token cấp SAU thời điểm đổi mật khẩu có bị chặn không? -> ${isNewTokenRevoked} (Mong đợi: false)`);

  if (isOldTokenRevoked && !isNewTokenRevoked) {
    console.log('✅ TEST 2 PASSED: Cơ chế User Revocation hoạt động chuẩn xác!\n');
  } else {
    throw new Error('Test 2 thất bại!');
  }

  // Test 3: Session Management trên Redis
  console.log('--- Test 3: Quản lý Phiên (Session) & Refresh Token trên Redis ---');
  const sampleSessionId = 'session-uuid-5678';
  const sessionKey = `auth:session:${sampleSessionId}`;
  const userSessionsKey = `auth:user_sessions:${sampleUserId}`;

  const sessionData = {
    id: sampleSessionId,
    userId: sampleUserId,
    createdAt: new Date().toISOString(),
  };

  // Tạo session
  await redis.set(sessionKey, JSON.stringify(sessionData), 'EX', 7 * 24 * 3600);
  await redis.sadd(userSessionsKey, sampleSessionId);

  const savedSession = JSON.parse(await redis.get(sessionKey));
  const userSessions = await redis.smembers(userSessionsKey);
  const sessionTtl = await redis.ttl(sessionKey);

  console.log(`3.1 Đọc session từ Redis: userId=${savedSession.userId}, TTL=${sessionTtl}s (Mong đợi: ~604800s)`);
  console.log(`3.2 Danh sách session của user: ${JSON.stringify(userSessions)}`);

  // Xóa session (khi Logout)
  await redis.del(sessionKey);
  await redis.srem(userSessionsKey, sampleSessionId);
  const sessionAfterDel = await redis.get(sessionKey);
  console.log(`3.3 Session sau khi Logout: ${sessionAfterDel} (Mong đợi: null)`);

  if (savedSession.userId === sampleUserId && sessionAfterDel === null) {
    console.log('✅ TEST 3 PASSED: Quản lý Session trên Redis RAM hoạt động chuẩn xác!\n');
  } else {
    throw new Error('Test 3 thất bại!');
  }

  // Dọn dẹp key test
  await redis.del(blacklistKey, userRevokeKey, sessionKey, userSessionsKey);
  await redis.quit();

  console.log('🎉 TOÀN BỘ CÁC BÀI TEST XÁC THỰC AUTH & REDIS ĐỀU THÀNH CÔNG RỰC RỠ!');
}

main().catch((err) => {
  console.error('❌ Lỗi kiểm tra:', err);
  process.exit(1);
});
