import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../../../infrastructure/redis/redis.service.js';

export type PasswordResetRecord = {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
};

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly RESET_TTL_SECONDS = 3600; // 1 giờ

  constructor(private readonly redis: RedisService) {}

  /**
   * Lưu token đặt lại mật khẩu vào Redis với TTL 1 giờ
   */
  async create(hash: string, userId: string): Promise<void> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.RESET_TTL_SECONDS * 1000);

    const record: PasswordResetRecord = {
      id: hash,
      userId,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    if (this.redis.isEnabled()) {
      await this.redis.set(`auth:pwd_reset:${hash}`, record, this.RESET_TTL_SECONDS);
      this.logger.log(`[PasswordReset] Saved reset token in Redis: hash=${hash.slice(0, 12)}..., user=${userId}`);
    }
  }

  /**
   * Lấy thông tin yêu cầu đặt lại mật khẩu từ Redis
   */
  async findOne(hash: string): Promise<PasswordResetRecord | null> {
    if (!hash || !this.redis.isEnabled()) return null;

    return this.redis.get<PasswordResetRecord>(`auth:pwd_reset:${hash}`);
  }

  /**
   * Xóa token đặt lại mật khẩu sau khi sử dụng thành công
   */
  async remove(hash: string): Promise<void> {
    if (!this.redis.isEnabled() || !hash) return;
    await this.redis.delete(`auth:pwd_reset:${hash}`);
    this.logger.log(`[PasswordReset] Removed reset token from Redis: ${hash.slice(0, 12)}...`);
  }
}
