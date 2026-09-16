import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../../infrastructure/cache/redis/redis.service.js';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import { IForgotPasswordService, ForgotPasswordCreate } from './forgot-password.js';
import { FindOptions } from '../../../common/utils/types/find-options.type.js';
import { ForgotPassword } from './entities/forgot-password.entity.js';

@Injectable()
export class ForgotPasswordService implements IForgotPasswordService {
  private readonly logger = new Logger(ForgotPasswordService.name);
  private readonly RESET_TTL_SECONDS = 3600; // 1 giờ

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  async create(data: ForgotPasswordCreate): Promise<ForgotPassword> {
    const userId = data.userId ?? (typeof data.user === 'object' ? data.user?.id : data.user);
    if (!userId || !data.hash) throw new Error('Password reset requires userId and hash');

    const now = new Date();
    const expiresAt = data.expiresAt ?? new Date(now.getTime() + this.RESET_TTL_SECONDS * 1000);

    const record = {
      id: data.hash,
      userId,
      hash: data.hash,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    if (this.redis.isEnabled()) {
      await this.redis.set(`auth:pwd_reset:${data.hash}`, record, this.RESET_TTL_SECONDS);
      this.logger.log(`[ForgotPassword] Saved reset token in Redis: hash=${data.hash.slice(0, 12)}..., user=${userId}`);
    }

    const user = typeof data.user === 'object' ? data.user : await this.prisma.user.findUnique({ where: { id: userId } });

    const entity = new ForgotPassword();
    entity.id = data.hash;
    entity.hash = data.hash;
    entity.userId = userId;
    entity.createdAt = now;
    entity.expiresAt = expiresAt;
    if (user) {
      entity.user = user as any;
    }
    return entity;
  }

  async findOne(options: FindOptions<ForgotPassword>): Promise<ForgotPassword | null> {
    const hash = (options.where as { hash?: string })?.hash;
    if (!hash || !this.redis.isEnabled()) return null;

    const raw = await this.redis.get<{
      id: string;
      userId: string;
      hash: string;
      createdAt: string;
      expiresAt: string;
    }>(`auth:pwd_reset:${hash}`);

    if (!raw) return null;

    const user = await this.prisma.user.findUnique({ where: { id: raw.userId } });
    if (!user || user.isDeleted) return null;

    const entity = new ForgotPassword();
    entity.id = raw.id;
    entity.hash = raw.hash;
    entity.userId = raw.userId;
    entity.createdAt = new Date(raw.createdAt);
    entity.expiresAt = new Date(raw.expiresAt);
    entity.user = Object.assign(user, {
      role: user.role?.toLowerCase(),
      status: user.status?.toLowerCase(),
      provider: user.provider?.toLowerCase(),
    }) as any;
    return entity;
  }

  async softDelete(id: string): Promise<void> {
    if (!this.redis.isEnabled() || !id) return;
    await this.redis.delete(`auth:pwd_reset:${id}`);
    this.logger.log(`[ForgotPassword] Removed reset token from Redis: ${id.slice(0, 12)}...`);
  }
}
