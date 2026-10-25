import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { RedisService } from '../../../../infrastructure/redis/redis.service.js';

export type OtpPurpose = 'reg' | 'link';

export interface OtpData {
  hash: string;
  attempts: number;
}

/**
 * AuthOtpService — Đơn trách nhiệm: Quản lý vòng đời OTP (tạo, lưu, xác thực, resend).
 *
 * OTP key schema:
 *   auth:otp:{purpose}:{identifier}
 *   auth:otp:cooldown:{purpose}:{identifier}
 */
@Injectable()
export class AuthOtpService {
  private readonly logger = new Logger(AuthOtpService.name);
  private readonly OTP_TTL_SECONDS = 600;
  private readonly COOLDOWN_TTL_SECONDS = 60;
  private readonly MAX_ATTEMPTS = 5;

  constructor(private readonly redis: RedisService) {}

  // ─── Generation ───────────────────────────────────────────────────────────

  generateOtp(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  hashOtp(otp: string): string {
    return createHash('sha256').update(otp).digest('hex');
  }

  // ─── Storage ──────────────────────────────────────────────────────────────

  /**
   * Lưu OTP hash vào Redis với TTL = 600s.
   * Đặt thêm cooldown key để chặn resend trong 60s.
   */
  async storeOtp(purpose: OtpPurpose, identifier: string, otp: string): Promise<void> {
    if (!this.redis.isEnabled()) return;
    const hash = this.hashOtp(otp);
    const data: OtpData = { hash, attempts: 0 };
    await this.redis.set(this.otpKey(purpose, identifier), data, this.OTP_TTL_SECONDS);
    await this.redis.set(this.cooldownKey(purpose, identifier), '1', this.COOLDOWN_TTL_SECONDS);
    this.logger.debug(`OTP stored [purpose=${purpose}, id=${identifier.slice(0, 4)}***]`);
  }

  // ─── Verification ─────────────────────────────────────────────────────────

  /**
   * Xác thực OTP. Tự động tăng attempt và giữ nguyên TTL còn lại (chống brute-force).
   * @throws HttpException nếu OTP sai, hết hạn, hoặc bị khóa
   */
  async verifyOtp(purpose: OtpPurpose, identifier: string, suppliedOtp: string): Promise<void> {
    if (!this.redis.isEnabled()) {
      throw new HttpException('Hệ thống xác thực tạm thời gián đoạn', HttpStatus.SERVICE_UNAVAILABLE);
    }

    const key = this.otpKey(purpose, identifier);
    const otpData = await this.redis.get<OtpData>(key);

    if (!otpData?.hash) {
      throw new HttpException(
        'Mã OTP không tồn tại hoặc đã hết hạn. Vui lòng gửi lại OTP mới.',
        HttpStatus.BAD_REQUEST,
      );
    }

    if ((otpData.attempts || 0) >= this.MAX_ATTEMPTS) {
      throw new HttpException(
        'Mã OTP đã bị khóa do nhập sai quá nhiều lần. Vui lòng gửi lại OTP mới.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const suppliedHash = this.hashOtp(suppliedOtp);
    const expected = Buffer.from(otpData.hash, 'hex');
    const supplied = Buffer.from(suppliedHash, 'hex');

    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      otpData.attempts = (otpData.attempts || 0) + 1;
      // Giữ nguyên TTL còn lại — ngăn brute-force vô hạn thời gian bằng cách reset TTL
      const remainingTtl = await this.redis.getTtl(key);
      const safeTtl = remainingTtl > 0 ? remainingTtl : 60;
      await this.redis.set(key, otpData, safeTtl);
      throw new HttpException('Mã OTP không chính xác', HttpStatus.BAD_REQUEST);
    }
  }

  /**
   * Xóa OTP sau khi xác thực thành công.
   */
  async deleteOtp(purpose: OtpPurpose, identifier: string): Promise<void> {
    await this.redis.delete(this.otpKey(purpose, identifier));
  }

  // ─── Cooldown ─────────────────────────────────────────────────────────────

  /**
   * Kiểm tra xem có đang trong thời gian cooldown không.
   * @throws HttpException 429 nếu đang cooldown
   */
  async checkCooldown(purpose: OtpPurpose, identifier: string): Promise<void> {
    if (!this.redis.isEnabled()) return;
    const inCooldown = await this.redis.exists(this.cooldownKey(purpose, identifier));
    if (inCooldown) {
      throw new HttpException(
        'Vui lòng chờ 60 giây trước khi gửi lại OTP',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private otpKey(purpose: OtpPurpose, identifier: string): string {
    return `auth:otp:${purpose}:${identifier}`;
  }

  private cooldownKey(purpose: OtpPurpose, identifier: string): string {
    return `auth:otp:cooldown:${purpose}:${identifier}`;
  }
}
