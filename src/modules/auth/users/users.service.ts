import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
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
import { calculateEffectivePermissions } from '../permissions/constants/permissions.constant.js';
import { RedisService } from '../../../infrastructure/redis/redis.service.js';
import { buildDoctorProfileData, syncDoctorSpecialties } from './helpers/doctor-profile.helper.js';
import type { OAuthProvider, SocialType } from '../../../common/utils/social.type.js';
import { normalizePhoneVariants } from '../../../common/utils/phone.util.js';

const oauthUserSelect = {
  id: true, email: true, phoneNumber: true, avatarUrl: true,
  status: true, isBlocked: true, isDeleted: true,
} satisfies Prisma.UserSelect;

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
      const targetBranchId = dto.branchId || null;
      if (this.toPrismaRole(dto.role ?? UserRole.Patient) === 'BRANCH_MANAGER') await this.validateBranchManager(tx, targetBranchId);
      if (this.toPrismaRole(dto.role ?? UserRole.Patient) === 'DOCTOR') await this.validateDoctorBranch(tx, targetBranchId);
      const row = await tx.user.create({
        data: {
          email,
          password: dto.password ? await hashPassword(dto.password) : null,
          fullName: dto.fullName,
          phoneNumber: phoneNumber ?? null,
          avatarUrl: avatarUrl ?? null,
          role: this.toPrismaRole(dto.role ?? UserRole.Patient),
          status: this.toPrismaStatus(dto.status ?? UserStatus.Active),
          customPermissions: dto.customPermissions as unknown as Prisma.InputJsonValue | undefined,
          hash: dto.hash ?? null,
          branchId: targetBranchId,
        },
      });

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
          branch: true,
        },
      });
      return userWithRelations ? this.toEntity(userWithRelations) : this.toEntity(row);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(error => this.handleManagerConflict(error));
  }

  async findOneUser(options: EntityCondition<User>): Promise<NullableType<User>> {
    const where = this.toWhere(options as Record<string, unknown>);
    const row = await this.prisma.user.findFirst({ where, include: { doctor: { include: { specialties: { include: { specialty: true } } } }, branch: true } });
    return row ? this.toEntity(row) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() }, include: { doctor: { include: { specialties: { include: { specialty: true } } } }, branch: true } });
    return row ? this.toEntity(row) : null;
  }

  /** Resolve a verified external identity and its user in one atomic transaction. */
  async resolveOAuthUser(provider: OAuthProvider, profile: SocialType): Promise<User> {
    const providerAccountId = profile.id?.trim();
    if (!['GOOGLE', 'ZALO'].includes(provider) || !providerAccountId || providerAccountId.length > 255) {
      throw new BadRequestException('Định danh đăng nhập bên ngoài không hợp lệ.');
    }
    // Only claims verified by the provider may select or populate an existing account.
    const email = profile.emailVerified === true ? profile.email?.trim().toLowerCase() || null : null;
    const phoneNumber = profile.phoneNumberVerified === true ? profile.phoneNumber?.trim() || null : null;
    const phoneVariants = phoneNumber ? normalizePhoneVariants(phoneNumber) : [];

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const identity = await tx.oAuthAccount.findUnique({
            where: { provider_providerAccountId: { provider, providerAccountId } },
            select: { user: { select: oauthUserSelect } },
          });
          let user = identity?.user;
          if (!user && (email || phoneVariants.length)) {
            const matches = await tx.user.findMany({
              where: { OR: [
                ...(email ? [{ email }] : []),
                ...(phoneVariants.length ? [{ phoneNumber: { in: phoneVariants } }] : []),
              ] },
              take: 2,
              select: oauthUserSelect,
            });
            if (matches.length > 1) {
              throw new ConflictException('Email và số điện thoại thuộc các tài khoản khác nhau. Không thể tự liên kết.');
            }
            user = matches[0];
          }

          if (user) {
            if (user.isDeleted) throw new UnauthorizedException('Tài khoản không tồn tại hoặc đã bị xóa');
            if (user.isBlocked) throw new UnauthorizedException('Tài khoản đã bị khóa');
            if (user.status !== 'ACTIVE') throw new UnauthorizedException('Tài khoản chưa được kích hoạt');
            user = await tx.user.update({
              where: { id: user.id },
              select: oauthUserSelect,
              data: {
                ...(!user.email && email ? { email } : {}),
                ...(!user.phoneNumber && phoneNumber ? { phoneNumber } : {}),
                ...(!user.avatarUrl && profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
                lastLoginAt: new Date(),
              },
            });
          } else {
            user = await tx.user.create({
              select: oauthUserSelect,
              data: {
                email, phoneNumber,
                fullName: profile.fullName?.trim() || null,
                avatarUrl: profile.avatarUrl || null,
                role: 'PATIENT', status: 'ACTIVE', lastLoginAt: new Date(),
              },
            });
          }

          if (!identity) {
            // Never reassign an existing provider identity to another user.
            await tx.oAuthAccount.create({ data: { userId: user.id, provider, providerAccountId } });
          }
          const row = await tx.user.findUniqueOrThrow({
            where: { id: user.id },
            include: {
              doctor: { include: { specialties: { include: { specialty: true } } } },
              branch: true,
            },
          });
          return this.toEntity(row);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !['P2002', 'P2034'].includes(error.code)) throw error;
        // A concurrent login may have created the same user/identity; read it again.
        if (attempt === 2) throw new ConflictException('Tài khoản vừa được cập nhật. Vui lòng thử đăng nhập lại.');
      }
    }
    throw new ConflictException('Không thể liên kết tài khoản đăng nhập.');
  }

  async findByPhoneVariants(variants: string[]): Promise<User | null> {
    if (!variants.length) return null;
    const row = await this.prisma.user.findFirst({
      where: { OR: variants.map((phoneNumber) => ({ phoneNumber })) },
      include: {
        doctor: { include: { specialties: { include: { specialty: true } } } },
        branch: true,
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
          branch: { select: { id: true, code: true, name: true } },
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
    if (next.isDeleted === true) next.status = UserStatus.Inactive;
    const p = payload as any;
    const row = await this.prisma.$transaction(async (tx) => {
      const stored = await tx.user.findUnique({ where: { id }, select: { role: true, branchId: true } });
      if (!stored) throw new NotFoundException('Không tìm thấy người dùng');
      const nextRole = this.toPrismaRole(payload.role ?? stored.role);
      const targetBranchId = p.branchId !== undefined
        ? (p.branchId || null)
        : (['ADMIN', 'CHAIN_MANAGER'].includes(nextRole) ? null : stored.branchId);
      if (p.branchId !== undefined || ['ADMIN', 'CHAIN_MANAGER'].includes(nextRole)) next.branchId = targetBranchId;
      if (nextRole === 'BRANCH_MANAGER' && payload.isDeleted !== true) await this.validateBranchManager(tx, targetBranchId, id);
      if (nextRole === 'DOCTOR') {
        await this.validateDoctorBranch(tx, targetBranchId);
        if (stored.branchId && stored.branchId !== targetBranchId) {
          const future = await tx.doctorSchedule.count({ where: { doctor: { userId: id }, branchId: stored.branchId, status: 'OPEN', workDate: { gte: new Date(new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)) } } });
          if (future) throw new BadRequestException('Bác sĩ còn ca làm việc tại chi nhánh cũ. Vui lòng xử lý lịch trước khi chuyển chi nhánh.');
        }
      }
      const row = await tx.user.update({ where: { id }, data: await this.toUpdateData(next, existing) });
      if (String(row.role).toUpperCase() === 'DOCTOR') {
        const storedDoctor = await tx.doctor.findUnique({
          where: { userId: row.id },
          select: { academicRank: true, licenseNumber: true, consultationFee: true, onlineConsultationFee: true, isOnlineConsultationEnabled: true, biography: true, avatarUrl: true },
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
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(error => this.handleManagerConflict(error));
    this.permissionsService.invalidateCache(id);
    if (payload.isBlocked !== undefined || payload.isDeleted !== undefined) await this.invalidateUserStatusCache(id);

    await this.recordHistory(row, HISTORY_ACTIONS.USER_UPDATED, 'Cập nhật người dùng');
    const updatedWithRelations = await this.prisma.user.findUnique({
      where: { id: row.id },
      include: {
        doctor: { include: { specialties: { include: { specialty: true } } } },
        branch: true,
      },
    });
    const entity = updatedWithRelations ? this.toEntity(updatedWithRelations) : this.toEntity(row);
    delete (entity as any).password;
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

  private toWhere(input: Record<string, unknown>): Prisma.UserWhereInput {
    return {
      id: input.id as string | undefined,
      email: typeof input.email === 'string' ? input.email.trim().toLowerCase() : undefined,
      phoneNumber: typeof input.phoneNumber === 'string' ? input.phoneNumber.trim() : undefined,
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
      status: payload.status ? this.toPrismaStatus(payload.status) : undefined,
      role: payload.role ? this.toPrismaRole(payload.role) : undefined,
      customPermissions: payload.customPermissions === null ? Prisma.JsonNull : payload.customPermissions as Prisma.InputJsonValue | undefined,
      hash: payload.hash,
      isBlocked: payload.isBlocked,
      isDeleted: payload.isDeleted,
      lastLoginAt: payload.lastLoginAt,
      branch: p.branchId !== undefined
        ? (p.branchId ? { connect: { id: p.branchId } } : { disconnect: true })
        : undefined,
    };
  }

  private toEntity(row: PrismaUser): User {
    return Object.assign(new User(), row, {
      role: row.role.toLowerCase() as UserRole,
      status: row.status.toLowerCase() as UserStatus,
      customPermissions: row.customPermissions as User['customPermissions'],
    });
  }

  private toSafeEntity(row: PrismaUser): User {
    const entity = this.toEntity(row);
    delete (entity as any).password;
    delete (entity as any).hash;
    (entity as any).effectivePermissions = calculateEffectivePermissions(row.role, row.customPermissions);
    return entity;
  }

  private handleManagerConflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002' && /branch_id|users_primary_branch_manager_key/.test(JSON.stringify(error.meta))) {
        throw new ConflictException('Chi nhánh đã có quản lý chính. Vui lòng dùng chức năng Đổi quản lý tại danh sách chi nhánh.');
      }
      if (error.code === 'P2034') throw new ConflictException('Dữ liệu nhân sự vừa thay đổi. Vui lòng tải lại và thử lại.');
    }
    throw error;
  }

  private async validateBranchManager(tx: Prisma.TransactionClient, branchId: number | null, userId?: string) {
    if (!branchId) return;
    await tx.$queryRaw`SELECT id FROM branches WHERE id = ${branchId} FOR UPDATE`;
    const branch = await tx.branch.findUnique({ where: { id: branchId }, select: { isActive: true } });
    if (!branch?.isActive) throw new BadRequestException('Chi nhánh không tồn tại hoặc đã ngừng hoạt động.');
    const occupied = await tx.user.findFirst({
      where: { branchId, role: 'BRANCH_MANAGER', isDeleted: false, ...(userId ? { id: { not: userId } } : {}) }, select: { id: true },
    });
    if (occupied) throw new ConflictException('Chi nhánh đã có quản lý chính. Vui lòng dùng chức năng Đổi quản lý tại danh sách chi nhánh.');
  }

  private async validateDoctorBranch(tx: Prisma.TransactionClient, branchId: number | null) {
    if (!branchId) throw new BadRequestException('Bác sĩ phải được phân công đúng một chi nhánh.');
    const branch = await tx.branch.findFirst({ where: { id: branchId, isActive: true }, select: { id: true } });
    if (!branch) throw new BadRequestException('Chi nhánh làm việc không tồn tại hoặc đã ngừng hoạt động.');
  }

  private toPrismaRole(value: UserRole | string): any { return String(value).toUpperCase(); }
  private toPrismaStatus(value: UserStatus | string): any { return String(value).toUpperCase(); }

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
