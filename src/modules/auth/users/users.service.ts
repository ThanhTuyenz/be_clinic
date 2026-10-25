import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException, Inject } from '@nestjs/common';
import { Prisma, User as PrismaUser } from '@prisma/client';
import { EntityCondition } from '../../../common/utils/types/entity-condition.type.js';
import { NullableType } from '../../../common/utils/types/nullable.type.js';
import { hashPassword } from '../../../common/utils/helpers.js';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import { CreateUserDto } from './dtos/create-user.dto.js';
import { User, UserRole, UserStatus } from './entities/user.entity.js';
import { FindUsersOptions, IUsersService, UsersPaginatedResult, UserUpdate } from './users.js';
import { HistoryService } from '../history/history.service.js';
import { HISTORY_ACTIONS } from '../history/history.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { calculateEffectivePermissions } from '../../../common/constants/permissions.constant.js';
import { RedisService } from '../../../infrastructure/redis/redis.service.js';
import { buildDoctorProfileData, syncDoctorSpecialties } from './helpers/doctor-profile.helper.js';

@Injectable()
export class UsersService implements IUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historyService: HistoryService,
    private readonly permissionsService: PermissionsService,
    private readonly redis: RedisService,
  ) {}

  async createUser(dto: CreateUserDto): Promise<User> {
    const email = dto.email ? dto.email.trim().toLowerCase() : null;
    const phoneNumber = dto.phoneNumber ? String(dto.phoneNumber).trim() : null;
    const avatarUrl = dto.avatarUrl ? String(dto.avatarUrl).trim() : null;
    if (!email && !phoneNumber) throw new Error('Email hoặc số điện thoại không được gửi tới server.');
    if (email && (await this.prisma.user.findUnique({ where: { email } }))) {
      throw new HttpException('Email này đã được sử dụng', HttpStatus.CONFLICT);
    }
    if (phoneNumber && (await this.prisma.user.findFirst({ where: { phoneNumber } }))) {
      throw new HttpException('Số điện thoại này đã được sử dụng', HttpStatus.CONFLICT);
    }
    return this.prisma.$transaction(async (tx) => {
      const targetBranchIds: string[] = [...new Set(dto.branchIds !== undefined ? dto.branchIds : (dto.branchId ? [dto.branchId] : []))];
      if (this.toPrismaRole(dto.role ?? UserRole.Patient) === 'DOCTOR') await this.validateDoctorBranch(tx, targetBranchIds, dto.primaryBranchId);
      const row = await tx.user.create({
        data: {
          email,
          password: dto.password ? await hashPassword(dto.password) : null,
          fullName: dto.fullName,
          phoneNumber: phoneNumber ?? null,
          avatarUrl: avatarUrl ?? null,
          role: this.toPrismaRole(dto.role ?? UserRole.Patient),
          status: this.toPrismaStatus(dto.status ?? UserStatus.Active),
          provider: this.toPrismaProvider(dto.provider ?? 'email'),
          socialId: dto.socialId ?? null,
          zaloId: dto.zaloId ?? null,
          roleId: dto.roleId ?? null,
          customPermissions: dto.customPermissions as unknown as Prisma.InputJsonValue | undefined,
          hash: dto.hash ?? null,
        },
      });

      const primaryId = dto.primaryBranchId || targetBranchIds[0];

      for (const bId of targetBranchIds) {
        if (!bId) continue;
        await tx.userBranchAssignment.upsert({
          where: { userId_branchId: { userId: row.id, branchId: bId } },
          update: { isPrimary: bId === primaryId },
          create: { userId: row.id, branchId: bId, isPrimary: bId === primaryId },
        });
      }

      if (row.role === 'DOCTOR') {
        const doctorData = buildDoctorProfileData(dto);
        const docRec = await tx.doctor.upsert({
          where: { userId: row.id },
          update: doctorData,
          create: { userId: row.id, ...doctorData },
        });
        await syncDoctorSpecialties(tx, docRec.id, dto, true);
      }

      const userWithRelations = await tx.user.findUnique({
        where: { id: row.id },
        include: {
          doctor: { include: { specialties: { include: { specialty: true } } } },
          branchAssignments: { include: { branch: true } },
        },
      });
      return userWithRelations ? this.toEntity(userWithRelations) : this.toEntity(row);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async findOneUser(options: EntityCondition<User>): Promise<NullableType<User>> {
    const where = this.toWhere(options as Record<string, unknown>);
    const row = await this.prisma.user.findFirst({ where, include: { doctor: { include: { specialties: { include: { specialty: true } } } }, branchAssignments: { include: { branch: true } } } });
    return row ? this.toEntity(row) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() }, include: { doctor: { include: { specialties: { include: { specialty: true } } } }, branchAssignments: { include: { branch: true } } } });
    return row ? this.toEntity(row) : null;
  }

  async findByPhoneVariants(variants: string[]): Promise<User | null> {
    if (!variants.length) return null;
    const row = await this.prisma.user.findFirst({
      where: { OR: variants.map((phoneNumber) => ({ phoneNumber })) },
      include: {
        doctor: { include: { specialties: { include: { specialty: true } } } },
        branchAssignments: { include: { branch: true } },
      },
    });
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
      this.prisma.user.findMany({
        where,
        include: {
          branchAssignments: {
            select: {
              isPrimary: true,
              branchId: true,
              branch: { select: { id: true, code: true, name: true } },
            },
          },
          doctor: {
            select: {
              id: true,
              userId: true,
              academicRank: true,
              licenseNumber: true,
              experienceYears: true,
              consultationFee: true,
              onlineConsultationFee: true,
              isOnlineConsultationEnabled: true,
              isActive: true,
              biography: true,
              slotDuration: true,
              isFeatured: true,
              avatarUrl: true,
              specialties: {
                select: {
                  isPrimary: true,
                  specialtyId: true,
                  specialty: { select: { id: true, name: true, slug: true } },
                },
              },
            },
          },
        },
        skip: (options.page - 1) * options.limit,
        take: options.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { data: rows.map((row) => this.toSafeEntity(row)), total };
  }

  async updateUser(id: string, payload: UserUpdate): Promise<User> {
    const existing = await this.findOneUser({ id });
    if (!existing) throw new NotFoundException('Không tìm thấy người dùng');
    const next = { ...payload };
    if (next.isBlocked === true) next.blockedAt = existing.blockedAt ?? new Date();
    if (next.isBlocked === false) next.blockedAt = null;
    if (next.isDeleted === true) next.status = UserStatus.Inactive;
    const p = payload as any;
    const row = await this.prisma.$transaction(async (tx) => {
      const stored = await tx.user.findUnique({ where: { id }, select: { role: true, branchAssignments: { select: { branchId: true } } } });
      if (!stored) throw new NotFoundException('Không tìm thấy người dùng');
      const targetIds = [...new Set<string>(p.branchIds !== undefined ? p.branchIds : p.branchId !== undefined ? (p.branchId ? [p.branchId] : []) : stored.branchAssignments.map((branch) => branch.branchId))];
      if (this.toPrismaRole(payload.role ?? stored.role) === 'DOCTOR') {
        await this.validateDoctorBranch(tx, targetIds, p.primaryBranchId);
        if (stored.branchAssignments.length === 1 && stored.branchAssignments[0].branchId !== targetIds[0]) {
          const future = await tx.doctorSchedule.count({ where: { doctor: { userId: id }, branchId: { not: targetIds[0] }, status: 'OPEN', workDate: { gte: new Date(new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)) } } });
          if (future) throw new BadRequestException('Bác sĩ còn ca làm việc tại chi nhánh cũ. Vui lòng xử lý lịch trước khi chuyển chi nhánh.');
        }
      }
      const row = await tx.user.update({ where: { id }, data: await this.toUpdateData(next, existing) });
      if (p.branchIds !== undefined || p.branchId !== undefined) {
        const targetBranchIds: string[] = Array.isArray(p.branchIds)
          ? p.branchIds
          : (p.branchId ? [p.branchId] : []);
        const primaryId = p.primaryBranchId || targetBranchIds[0];

        if (targetBranchIds.length > 0) {
          await tx.userBranchAssignment.deleteMany({
            where: { userId: row.id, branchId: { notIn: targetBranchIds } },
          });
          for (const bId of targetBranchIds) {
            if (!bId) continue;
            await tx.userBranchAssignment.upsert({
              where: { userId_branchId: { userId: row.id, branchId: bId } },
              update: { isPrimary: bId === primaryId },
              create: { userId: row.id, branchId: bId, isPrimary: bId === primaryId },
            });
          }
        }
      }

      if (String(row.role).toUpperCase() === 'DOCTOR') {
        const storedDoctor = await tx.doctor.findUnique({
          where: { userId: row.id },
          select: { academicRank: true, licenseNumber: true, consultationFee: true, onlineConsultationFee: true, isOnlineConsultationEnabled: true },
        });
        const doctorData = buildDoctorProfileData(p, storedDoctor);
        const docRec = await tx.doctor.upsert({
          where: { userId: row.id },
          update: doctorData,
          create: { userId: row.id, ...doctorData },
        });
        await syncDoctorSpecialties(tx, docRec.id, p, !storedDoctor);
      }

      return row;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    this.permissionsService.invalidateCache(id);
    if (payload.isBlocked !== undefined || payload.isDeleted !== undefined) await this.invalidateUserStatusCache(id);

    await this.recordHistory(row, HISTORY_ACTIONS.USER_UPDATED, 'Cập nhật người dùng');
    const updatedWithRelations = await this.prisma.user.findUnique({
      where: { id: row.id },
      include: {
        doctor: { include: { specialties: { include: { specialty: true } } } },
        branchAssignments: { include: { branch: true } },
      },
    });
    const entity = updatedWithRelations ? this.toEntity(updatedWithRelations) : this.toEntity(row);
    delete (entity as any).password;
    delete (entity as any).previousPassword;
    delete (entity as any).hash;
    return entity;
  }

  async deleteUser(id: string): Promise<void> {
    const existing = await this.findOneUser({ id });
    if (!existing) throw new NotFoundException('Không tìm thấy người dùng');
    const row = await this.prisma.user.update({ where: { id }, data: { isDeleted: true, status: 'INACTIVE' } });
    await this.recordHistory(row, HISTORY_ACTIONS.USER_DELETED, 'Xóa người dùng');
    // Xóa cache ngay để JwtAuthGuard phát hiện soft-delete trong request tiếp theo
    await this.invalidateUserStatusCache(id);
  }

  async saveUser(user: User): Promise<User> {
    const existing = await this.findOneUser({ id: user.id });
    if (!existing) throw new NotFoundException('Không tìm thấy người dùng');
    const row = await this.prisma.user.update({ where: { id: user.id }, data: await this.toUpdateData(user, existing) });
    return this.toEntity(row);
  }

  async assignRole(userId: string, roleId: string): Promise<User> {
    return this.updateUser(userId, { roleId });
  }

  async removeRole(userId: string): Promise<User> {
    return this.updateUser(userId, { roleId: null });
  }

  private toWhere(input: Record<string, unknown>): Prisma.UserWhereInput {
    return {
      id: input.id as string | undefined,
      email: typeof input.email === 'string' ? input.email.trim().toLowerCase() : undefined,
      phoneNumber: typeof input.phoneNumber === 'string' ? input.phoneNumber.trim() : undefined,
      socialId: input.socialId as string | undefined,
      zaloId: typeof input.zaloId === 'string' ? input.zaloId.trim() : undefined,
      provider: input.provider ? this.toPrismaProvider(String(input.provider)) : undefined,
      hash: input.hash as string | undefined,
    };
  }

  private async toUpdateData(payload: UserUpdate, existing: User): Promise<Prisma.UserUpdateInput> {
    const passwordChanged = payload.password != null && payload.password !== existing.password;
    const p = payload as any;
    return {
      email: payload.email === undefined ? undefined : payload.email?.trim().toLowerCase(),
      phoneNumber: p.phoneNumber !== undefined ? (p.phoneNumber ? String(p.phoneNumber).trim() : null) : undefined,
      avatarUrl: p.avatarUrl !== undefined ? (p.avatarUrl ? String(p.avatarUrl).trim() : null) : undefined,
      password: passwordChanged ? await hashPassword(payload.password!) : undefined,
      fullName: payload.fullName,
      provider: payload.provider ? this.toPrismaProvider(payload.provider) : undefined,
      status: payload.status ? this.toPrismaStatus(payload.status) : undefined,
      role: payload.role ? this.toPrismaRole(payload.role) : undefined,
      socialId: payload.socialId,
      zaloId: p.zaloId !== undefined ? (p.zaloId ? String(p.zaloId).trim() : null) : undefined,
      roleId: payload.roleId,
      customPermissions: payload.customPermissions === null ? Prisma.JsonNull : payload.customPermissions as Prisma.InputJsonValue | undefined,
      hash: payload.hash,
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

  private toSafeEntity(row: PrismaUser): User {
    const entity = this.toEntity(row);
    delete (entity as any).password;
    delete (entity as any).previousPassword;
    delete (entity as any).hash;
    (entity as any).effectivePermissions = calculateEffectivePermissions(row.role, row.customPermissions);
    return entity;
  }

  private async validateDoctorBranch(tx: Prisma.TransactionClient, ids: string[], primaryId?: string | null) {
    if (ids.length !== 1 || !ids[0] || (primaryId && primaryId !== ids[0])) throw new BadRequestException('Mỗi bác sĩ phải được phân công đúng một chi nhánh.');
    const branch = await tx.branch.findFirst({ where: { id: ids[0], isActive: true }, select: { id: true } });
    if (!branch) throw new BadRequestException('Chi nhánh làm việc không tồn tại hoặc đã ngừng hoạt động.');
  }

  private toPrismaRole(value: UserRole | string): any { return String(value).toUpperCase(); }
  private toPrismaStatus(value: UserStatus | string): any { return String(value).toUpperCase(); }
  private toPrismaProvider(value: string): any { return String(value).toUpperCase(); }

  private async recordHistory(row: PrismaUser, action: string, prefix: string): Promise<void> {
    await this.historyService.create({ action, message: `${prefix} ${row.email}`, actorId: row.id, actorEmail: row.email ?? undefined, targetType: 'user', targetId: row.id });
  }

  /**
   * Xóa cache user:status:{id} trong Redis.
   * Gọi khi isBlocked/isDeleted của user thay đổi để JwtAuthGuard reload ngay lập tức.
   */
  async invalidateUserStatusCache(userId: string): Promise<void> {
    await this.redis.delete(`user:status:${userId}`);
  }
}
