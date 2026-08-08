import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import { Session } from './entities/session.entity.js';
import { User } from '../users/entities/user.entity.js';
import { FindOptions } from '../../../common/utils/types/find-options.type.js';
import { NullableType } from '../../../common/utils/types/nullable.type.js';
import { ISessionService, SessionCreate } from './session.js';

@Injectable()
export class SessionService implements ISessionService {
  constructor(private readonly prisma: PrismaService) {}

  async findOne(options: FindOptions<Session>): Promise<NullableType<Session>> {
    const where = this.toWhere((options.where ?? {}) as Record<string, unknown>);
    const row = await this.prisma.session.findFirst({ where, include: { user: true } });
    return row && !row.deletedAt ? this.toEntity(row) : null;
  }

  async findMany(options: FindOptions<Session>): Promise<Session[]> {
    const rows = await this.prisma.session.findMany({
      where: { ...this.toWhere((options.where ?? {}) as Record<string, unknown>), deletedAt: null },
      include: { user: true },
    });
    return rows.map((row) => this.toEntity(row));
  }

  async create(data: SessionCreate): Promise<Session> {
    const userId = data.user?.id ?? data.userId;
    if (!userId) throw new Error('Session requires userId');
    const row = await this.prisma.session.create({
      data: { userId, deletedAt: data.deletedAt ?? null },
      include: { user: true },
    });
    return this.toEntity(row);
  }

  async softDelete({ excludeId, ...criteria }: {
    id?: Session['id'];
    user?: Pick<User, 'id'>;
    excludeId?: Session['id'];
  }): Promise<void> {
    await this.prisma.session.updateMany({
      where: {
        id: criteria.id,
        userId: criteria.user?.id,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      data: { deletedAt: new Date() },
    });
  }

  private toWhere(where: Record<string, unknown>) {
    const user = where.user as { id?: string } | undefined;
    return { id: where.id as string | undefined, userId: user?.id };
  }

  private toEntity(row: any): Session {
    return Object.assign(new Session(), {
      id: row.id,
      userId: row.userId,
      user: row.user ? this.toUser(row.user) : undefined,
      createdAt: row.createdAt,
      deletedAt: row.deletedAt,
    });
  }

  private toUser(row: any): User {
    return Object.assign(new User(), row, {
      role: row.role?.toLowerCase(),
      status: row.status?.toLowerCase(),
      provider: row.provider?.toLowerCase(),
    });
  }
}
