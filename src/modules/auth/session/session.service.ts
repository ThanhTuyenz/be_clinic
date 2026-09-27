import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { RedisService } from '../../../infrastructure/redis/redis.service.js';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import { Session } from './entities/session.entity.js';
import { User } from '../users/entities/user.entity.js';
import { FindOptions } from '../../../common/utils/types/find-options.type.js';
import { NullableType } from '../../../common/utils/types/nullable.type.js';
import { ISessionService, SessionCreate } from './session.js';
import { ttlToMilliseconds } from '../../../config/auth.config.js';

@Injectable()
export class SessionService implements ISessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly sessionTtlSeconds: number;

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const refreshExpires = this.configService.get<string>('auth.refreshExpires') || '7d';
    this.sessionTtlSeconds = Math.floor(ttlToMilliseconds(refreshExpires) / 1000) || 7 * 24 * 3600;
  }

  async findOne(options: FindOptions<Session>): Promise<NullableType<Session>> {
    const where = this.toWhere((options.where ?? {}) as Record<string, unknown>);
    if (!where.id) return null;

    if (!this.redis.isEnabled()) return null;

    const key = `auth:session:${where.id}`;
    const raw = await this.redis.get<{ id: string; userId: string; createdAt: string }>(key);
    if (!raw) return null;

    const user = await this.prisma.user.findUnique({ where: { id: raw.userId } });
    if (!user || user.isDeleted) return null;

    const session = new Session();
    session.id = raw.id;
    session.userId = raw.userId;
    session.createdAt = new Date(raw.createdAt);
    session.user = this.toUser(user);
    return session;
  }

  async findMany(options: FindOptions<Session>): Promise<Session[]> {
    const where = this.toWhere((options.where ?? {}) as Record<string, unknown>);
    if (!where.userId || !this.redis.isEnabled()) return [];

    const sessionIds = await this.redis.smembers(`auth:user_sessions:${where.userId}`);
    const sessions: Session[] = [];
    for (const sid of sessionIds) {
      const s = await this.findOne({ where: { id: sid } });
      if (s) sessions.push(s);
    }
    return sessions;
  }

  async create(data: SessionCreate): Promise<Session> {
    const userId = data.user?.id ?? data.userId;
    if (!userId) throw new Error('Session requires userId');

    const sessionId = data.id || randomUUID();
    const now = new Date();

    const sessionData = {
      id: sessionId,
      userId,
      createdAt: now.toISOString(),
    };

    if (this.redis.isEnabled()) {
      const sessionKey = `auth:session:${sessionId}`;
      const userSessionsKey = `auth:user_sessions:${userId}`;

      await this.redis.set(sessionKey, sessionData, this.sessionTtlSeconds);
      await this.redis.sadd(userSessionsKey, sessionId);
      await this.redis.expire(userSessionsKey, this.sessionTtlSeconds);
      this.logger.log(`[Session] Created Redis session: ${sessionId} for user: ${userId} (TTL ${this.sessionTtlSeconds}s)`);
    }

    const session = new Session();
    session.id = sessionId;
    session.userId = userId;
    session.createdAt = now;
    if (data.user) {
      session.user = data.user as User;
    }
    return session;
  }

  async softDelete({ excludeId, ...criteria }: {
    id?: Session['id'];
    user?: Pick<User, 'id'>;
    excludeId?: Session['id'];
  }): Promise<void> {
    if (!this.redis.isEnabled()) return;

    if (criteria.id) {
      const sessionKey = `auth:session:${criteria.id}`;
      const existing = await this.redis.get<{ userId?: string }>(sessionKey);
      await this.redis.delete(sessionKey);
      if (existing?.userId) {
        await this.redis.srem(`auth:user_sessions:${existing.userId}`, criteria.id);
      }
      this.logger.log(`[Session] Deleted Redis session: ${criteria.id}`);
    }

    if (criteria.user?.id) {
      const userSessionsKey = `auth:user_sessions:${criteria.user.id}`;
      const sessionIds = await this.redis.smembers(userSessionsKey);
      for (const sid of sessionIds) {
        if (excludeId && sid === excludeId) continue;
        await this.redis.delete(`auth:session:${sid}`);
        await this.redis.srem(userSessionsKey, sid);
      }
      this.logger.log(`[Session] Revoked sessions for user: ${criteria.user.id} (excluded: ${excludeId ?? 'none'})`);
    }
  }

  private toWhere(where: Record<string, unknown>) {
    const user = where.user as { id?: string } | undefined;
    return { id: where.id as string | undefined, userId: user?.id };
  }

  private toUser(row: any): User {
    return Object.assign(new User(), row, {
      role: row.role?.toLowerCase(),
      status: row.status?.toLowerCase(),
      provider: row.provider?.toLowerCase(),
    });
  }
}
