import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import { IForgotPasswordService, ForgotPasswordCreate } from './forgot-password.js';
import { FindOptions } from '../../../common/utils/types/find-options.type.js';
import { ForgotPassword } from './entities/forgot-password.entity.js';

@Injectable()
export class ForgotPasswordService implements IForgotPasswordService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: ForgotPasswordCreate): Promise<ForgotPassword> {
    const userId = data.userId ?? (typeof data.user === 'object' ? data.user?.id : data.user);
    if (!userId || !data.hash) throw new Error('Password reset requires userId and hash');
    const row = await this.prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: data.hash,
        expiresAt: data.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
      },
      include: { user: true },
    });
    return this.toEntity(row);
  }

  async findOne(options: FindOptions<ForgotPassword>): Promise<ForgotPassword | null> {
    const hash = (options.where as { hash?: string })?.hash;
    if (!hash) return null;
    const row = await this.prisma.passwordResetToken.findFirst({
      where: { tokenHash: hash, consumedAt: null, expiresAt: { gt: new Date() } },
      include: { user: true },
    });
    return row ? this.toEntity(row) : null;
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.passwordResetToken.updateMany({
      where: { id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
  }

  private toEntity(row: any): ForgotPassword {
    return Object.assign(new ForgotPassword(), {
      id: row.id,
      hash: row.tokenHash,
      userId: row.userId,
      user: row.user ? { ...row.user, role: row.user.role?.toLowerCase(), status: row.user.status?.toLowerCase(), provider: row.user.provider?.toLowerCase() } : row.userId,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      deletedAt: row.consumedAt,
    });
  }
}
