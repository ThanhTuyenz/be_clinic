import { HttpException, HttpStatus, Injectable, NotFoundException, Inject } from '@nestjs/common';
import { Prisma, User as PrismaUser } from '@prisma/client';
import { EntityCondition } from '../../../common/utils/types/entity-condition.type.js';
import { NullableType } from '../../../common/utils/types/nullable.type.js';
import { hashPassword } from '../../../common/utils/helpers.js';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import { CreateUserDto } from './dtos/create-user.dto.js';
import { User, UserRole, UserStatus } from './entities/user.entity.js';
import { FindUsersOptions, IUsersService, UsersPaginatedResult, UserUpdate } from './users.js';
import { HistoryService } from '../../history/history.service.js';
import { HISTORY_ACTIONS } from '../../history/history.js';
import { IRolesService } from '../../roles/roles.js';
import { Services } from '../../../common/utils/constants.js';
import { PermissionsService } from '../../permissions/permissions.service.js';

@Injectable()
export class UsersService implements IUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historyService: HistoryService,
    @Inject(Services.ROLES) private readonly rolesService: IRolesService,
    private readonly permissionsService: PermissionsService,
  ) {}

  async createUser(dto: CreateUserDto): Promise<User> {
    const email = dto.email?.trim().toLowerCase();
    if (!email) throw new Error('Email không được gửi tới server.');
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new HttpException('User already exists', HttpStatus.CONFLICT);
    }
    if (dto.roleId) await this.rolesService.findOne(dto.roleId);
    const row = await this.prisma.user.create({
      data: {
        email,
        password: dto.password ? await hashPassword(dto.password) : null,
        fullName: dto.fullName,
        role: this.toPrismaRole(dto.role ?? UserRole.Patient),
        status: this.toPrismaStatus(dto.status ?? UserStatus.Active),
        provider: this.toPrismaProvider(dto.provider ?? 'email'),
        socialId: dto.socialId ?? null,
        roleId: dto.roleId ?? null,
        customPermissions: dto.customPermissions as unknown as Prisma.InputJsonValue | undefined,
        hash: dto.hash ?? null,
        emailOtpHash: (dto as any).emailOtpHash ?? null,
        emailOtpExpiresAt: (dto as any).emailOtpExpiresAt ?? null,
        emailOtpLastSentAt: (dto as any).emailOtpLastSentAt ?? null,
        emailOtpAttempts: (dto as any).emailOtpAttempts ?? 0,
      },
    });
    return this.toEntity(row);
  }

  async findOneUser(options: EntityCondition<User>): Promise<NullableType<User>> {
    const where = this.toWhere(options as Record<string, unknown>);
    const row = await this.prisma.user.findFirst({ where });
    return row ? this.toEntity(row) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    return row ? this.toEntity(row) : null;
  }

  async findUsersWithPagination(options: FindUsersOptions): Promise<UsersPaginatedResult> {
    const where: Prisma.UserWhereInput = {
      email: options.email ? { contains: options.email.trim(), mode: 'insensitive' } : undefined,
      fullName: options.name ? { contains: options.name.trim(), mode: 'insensitive' } : undefined,
      isBlocked: options.isBlocked,
      isDeleted: options.isDeleted ?? false,
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, skip: (options.page - 1) * options.limit, take: options.limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.user.count({ where }),
    ]);
    return { data: rows.map((row) => this.toEntity(row)), total };
  }

  async updateUser(id: string, payload: UserUpdate): Promise<User> {
    const existing = await this.findOneUser({ id });
    if (!existing) throw new NotFoundException('Không tìm thấy người dùng');
    if (payload.roleId) await this.rolesService.findOne(payload.roleId);
    const next = { ...payload };
    if (next.isBlocked === true) next.blockedAt = existing.blockedAt ?? new Date();
    if (next.isBlocked === false) next.blockedAt = null;
    if (next.isDeleted === true) next.status = UserStatus.Inactive;
    const row = await this.prisma.user.update({ where: { id }, data: await this.toUpdateData(next, existing) });
    await this.recordHistory(row, HISTORY_ACTIONS.USER_UPDATED, 'Cập nhật người dùng');
    this.permissionsService.invalidateCache(id);
    return this.toEntity(row);
  }

  async deleteUser(id: string): Promise<void> {
    const existing = await this.findOneUser({ id });
    if (!existing) throw new NotFoundException('Không tìm thấy người dùng');
    const row = await this.prisma.user.update({ where: { id }, data: { isDeleted: true, status: 'INACTIVE' } });
    await this.recordHistory(row, HISTORY_ACTIONS.USER_DELETED, 'Xóa người dùng');
  }

  async saveUser(user: User): Promise<User> {
    const existing = await this.findOneUser({ id: user.id });
    if (!existing) throw new NotFoundException('Không tìm thấy người dùng');
    const row = await this.prisma.user.update({ where: { id: user.id }, data: await this.toUpdateData(user, existing) });
    return this.toEntity(row);
  }

  async assignRole(userId: string, roleId: string): Promise<User> {
    await this.rolesService.findOne(roleId);
    return this.updateUser(userId, { roleId });
  }

  async removeRole(userId: string): Promise<User> {
    return this.updateUser(userId, { roleId: null });
  }

  private toWhere(input: Record<string, unknown>): Prisma.UserWhereInput {
    return {
      id: input.id as string | undefined,
      email: typeof input.email === 'string' ? input.email.trim().toLowerCase() : undefined,
      socialId: input.socialId as string | undefined,
      provider: input.provider ? this.toPrismaProvider(String(input.provider)) : undefined,
      hash: input.hash as string | undefined,
    };
  }

  private async toUpdateData(payload: UserUpdate, existing: User): Promise<Prisma.UserUpdateInput> {
    const passwordChanged = payload.password != null && payload.password !== existing.password;
    return {
      email: payload.email === undefined ? undefined : payload.email?.trim().toLowerCase(),
      password: passwordChanged ? await hashPassword(payload.password!) : undefined,
      fullName: payload.fullName,
      provider: payload.provider ? this.toPrismaProvider(payload.provider) : undefined,
      status: payload.status ? this.toPrismaStatus(payload.status) : undefined,
      role: payload.role ? this.toPrismaRole(payload.role) : undefined,
      socialId: payload.socialId,
      roleId: payload.roleId,
      customPermissions: payload.customPermissions === null ? Prisma.JsonNull : payload.customPermissions as Prisma.InputJsonValue | undefined,
      hash: payload.hash,
      emailOtpHash: payload.emailOtpHash,
      emailOtpExpiresAt: payload.emailOtpExpiresAt,
      emailOtpLastSentAt: payload.emailOtpLastSentAt,
      emailOtpAttempts: payload.emailOtpAttempts,
      isBlocked: payload.isBlocked,
      blockedAt: payload.blockedAt,
      isDeleted: payload.isDeleted,
      lastLoginAt: payload.lastLoginAt,
    };
  }

  private toEntity(row: PrismaUser): User {
    return Object.assign(new User(), row, {
      role: row.role.toLowerCase() as UserRole,
      status: row.status.toLowerCase() as UserStatus,
      provider: row.provider.toLowerCase(),
      customPermissions: row.customPermissions as User['customPermissions'],
      previousPassword: row.password,
    });
  }

  private toPrismaRole(value: UserRole | string): any { return String(value).toUpperCase(); }
  private toPrismaStatus(value: UserStatus | string): any { return String(value).toUpperCase(); }
  private toPrismaProvider(value: string): any { return String(value).toUpperCase(); }

  private async recordHistory(row: PrismaUser, action: string, prefix: string): Promise<void> {
    await this.historyService.create({ action, message: `${prefix} ${row.email}`, actorId: row.id, actorEmail: row.email ?? undefined, targetType: 'user', targetId: row.id });
  }
}
