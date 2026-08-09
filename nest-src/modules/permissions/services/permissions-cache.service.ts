import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PermissionRole } from '../enums';
import { Permission } from '../types/permission.type';

export interface CachedPermissions {
  role: PermissionRole;
  permissions: Permission[];
  cachedAt: number;
}

/**
 * In-memory cache service for permissions
 * TODO: Replace with Redis in production for distributed caching
 */
@Injectable()
export class PermissionsCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PermissionsCacheService.name);
  private readonly cache = new Map<string, CachedPermissions>();
  private readonly ttl: number;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(private readonly configService: ConfigService) {
    // Default TTL: 5 minutes (300000ms)
    this.ttl =
      this.configService.get<number>('PERMISSIONS_CACHE_TTL') || 300000;
  }

  onModuleInit() {
    // Cleanup expired entries every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpired();
    }, 60000);

    this.logger.log(`Permissions cache initialized with TTL: ${this.ttl}ms`);
  }

  onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }

  /**
   * Get cached permissions for a user
   */
  get(userId: string): CachedPermissions | null {
    const cached = this.cache.get(userId);

    if (!cached) {
      return null;
    }

    const now = Date.now();
    const age = now - cached.cachedAt;

    if (age > this.ttl) {
      this.cache.delete(userId);
      this.logger.debug(`Cache expired for user ${userId}`);
      return null;
    }

    this.logger.debug(`Cache hit for user ${userId}, age: ${age}ms`);
    return cached;
  }

  /**
   * Set cached permissions for a user
   */
  set(userId: string, role: PermissionRole, permissions: Permission[]): void {
    this.cache.set(userId, {
      role,
      permissions,
      cachedAt: Date.now(),
    });

    this.logger.debug(`Cached permissions for user ${userId}`);
  }

  /**
   * Invalidate cache for a specific user
   */
  invalidate(userId: string): void {
    const deleted = this.cache.delete(userId);
    if (deleted) {
      this.logger.debug(`Invalidated cache for user ${userId}`);
    }
  }

  /**
   * Invalidate all cached permissions
   */
  invalidateAll(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.logger.log(`Invalidated all cached permissions (${size} entries)`);
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; ttl: number } {
    return {
      size: this.cache.size,
      ttl: this.ttl,
    };
  }

  /**
   * Cleanup expired cache entries
   */
  private cleanupExpired(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [userId, cached] of this.cache.entries()) {
      const age = now - cached.cachedAt;
      if (age > this.ttl) {
        this.cache.delete(userId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug(`Cleaned up ${cleaned} expired cache entries`);
    }
  }
}
