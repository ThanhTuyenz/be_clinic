import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { RedisService } from '../../../infrastructure/cache/redis/redis.service.js';

@Injectable()
export class TokenBlacklistService {
  private readonly logger = new Logger(TokenBlacklistService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Băm token bằng SHA-256 để lưu trữ key trong Redis nhỏ gọn (32 bytes hex)
   */
  hashToken(token: string): string {
    return createHash('sha256').update(token.trim()).digest('hex');
  }

  /**
   * Đưa Access Token vào Blacklist trên Redis
   * @param token Chuỗi Access Token JWT
   * @param expSeconds Thời điểm hết hạn của JWT (epoch seconds) hoặc thời gian còn lại
   */
  async blacklistToken(token: string, expSeconds?: number): Promise<void> {
    if (!this.redis.isEnabled() || !token) return;

    try {
      let ttl = 900; // Mặc định 15 phút nếu không rõ exp
      if (expSeconds) {
        const nowSec = Math.floor(Date.now() / 1000);
        // Nếu expSeconds là timestamp tương lai (epoch seconds)
        ttl = expSeconds > nowSec ? expSeconds - nowSec : expSeconds;
        ttl = Math.max(ttl, 60); // Tối thiểu sống 60 giây
      }

      const key = `auth:blacklist:${this.hashToken(token)}`;
      await this.redis.set(key, 'revoked', ttl);
      this.logger.log(`[TokenBlacklist] Blacklisted token (hash=${key.slice(0, 24)}..., ttl=${ttl}s)`);
    } catch (err: any) {
      this.logger.error(`Failed to blacklist token: ${err?.message}`);
    }
  }

  /**
   * Kiểm tra xem Access Token có nằm trong danh sách đen (đã Logout) hay không
   */
  async isTokenBlacklisted(token: string): Promise<boolean> {
    if (!this.redis.isEnabled() || !token) return false;

    try {
      const key = `auth:blacklist:${this.hashToken(token)}`;
      return await this.redis.exists(key);
    } catch (err: any) {
      this.logger.warn(`Failed to check token blacklist: ${err?.message}`);
      return false;
    }
  }

  /**
   * Thu hồi quyền truy cập tức thì cho toàn bộ thiết bị của một User
   * (Dùng khi Đổi mật khẩu, Khóa tài khoản, hoặc Admin cưỡng chế đăng xuất)
   */
  async revokeUser(userId: string, ttlSeconds = 3600): Promise<void> {
    if (!this.redis.isEnabled() || !userId) return;

    try {
      const key = `auth:user_revoked_at:${userId}`;
      await this.redis.set(key, Date.now(), ttlSeconds);
      this.logger.log(`[TokenBlacklist] Revoked all tokens for user=${userId} issued before now`);
    } catch (err: any) {
      this.logger.error(`Failed to revoke user ${userId}: ${err?.message}`);
    }
  }

  /**
   * Kiểm tra xem Token của User có được cấp trước thời điểm bị thu hồi quyền hay không
   */
  async isUserRevoked(userId: string, tokenIatSeconds?: number): Promise<boolean> {
    if (!this.redis.isEnabled() || !userId || !tokenIatSeconds) return false;

    try {
      const key = `auth:user_revoked_at:${userId}`;
      const revokedAtMs = await this.redis.get<number>(key);
      if (!revokedAtMs) return false;

      // Nếu thời điểm cấp token (iat) trước thời điểm revoked -> Token bị vô hiệu
      return tokenIatSeconds * 1000 < revokedAtMs;
    } catch (err: any) {
      this.logger.warn(`Failed to check user revocation for ${userId}: ${err?.message}`);
      return false;
    }
  }
}
