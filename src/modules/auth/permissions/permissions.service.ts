import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import { RedisService } from '../../../infrastructure/redis/redis.service.js';
import {
  calculateEffectivePermissions,
  ROLE_DEFAULT_PERMISSIONS,
} from './constants/permissions.constant.js';

export type UserPermissionsResult = {
  role: string;
  effectivePermissions: string[];
  customPermissions: any;
  basePermissions: string[];
};

@Injectable()
export class PermissionsService {
  private readonly logger = new Logger(PermissionsService.name);
  private readonly PERMISSION_CACHE_TTL = 300; // 5 phút

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Lấy quyền hiệu lực của người dùng theo mô hình RBAC VitaCare
   * Effective = (Role Base Permissions + Granted) - Revoked
   * Tự động cache trong Redis 5 phút để tối ưu hiệu năng
   */
  async getUserPermissions(userId: string): Promise<UserPermissionsResult> {
    const cacheKey = `auth:v4:user_perms:${userId}`;
    if (this.redis.isEnabled()) {
      const cached = await this.redis.get<UserPermissionsResult>(cacheKey);
      if (cached) return cached;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, customPermissions: true, isBlocked: true, isDeleted: true },
    });

    if (!user || user.isDeleted || user.isBlocked) {
      return {
        role: 'patient',
        effectivePermissions: [],
        customPermissions: null,
        basePermissions: [],
      };
    }

    const roleNormalized = String(user.role).toLowerCase();
    const basePermissions = (ROLE_DEFAULT_PERMISSIONS[roleNormalized] || []).map((p) => String(p));
    const effectivePermissions = calculateEffectivePermissions(user.role, user.customPermissions);

    const result: UserPermissionsResult = {
      role: roleNormalized,
      basePermissions,
      customPermissions: user.customPermissions,
      effectivePermissions,
    };

    if (this.redis.isEnabled()) {
      await this.redis.set(cacheKey, result, this.PERMISSION_CACHE_TTL);
    }

    return result;
  }

  /**
   * Xóa cache quyền của một người dùng khi có thay đổi vai trò hoặc quyền tùy chỉnh
   */
  invalidateCache(userId: string): void {
    if (this.redis.isEnabled()) {
      this.redis.delete(`auth:v4:user_perms:${userId}`).catch((err) => {
        this.logger.warn(`Failed to invalidate permission cache for user ${userId}: ${err.message}`);
      });
      this.logger.log(`Invalidated permission cache for user ${userId}`);
    }
  }

}

