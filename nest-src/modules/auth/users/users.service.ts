import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Repository } from 'typeorm';

import { EntityCondition } from 'src/common/utils/types/entity-condition.type';
import { NullableType } from 'src/common/utils/types/nullable.type';
import { CreateUserDto } from './dtos/create-user.dto';
import { User, UserStatus } from './entities/user.entity';
import { FindUsersOptions, IUsersService, UsersPaginatedResult } from './users';
import { HistoryService } from '../../history/history.service';
import { HISTORY_ACTIONS } from '../../history/history';
import { IRolesService } from '../../roles/roles';
import { Services } from 'src/common/utils/constants';
import { PermissionsService } from '../../permissions/permissions.service';

@Injectable()
export class UsersService implements IUsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly historyService: HistoryService,
    @Inject(Services.ROLES)
    private readonly rolesService: IRolesService,
    private readonly permissionsService: PermissionsService,
  ) {}

  async createUser(createUserDto: CreateUserDto): Promise<User> {
    const email = createUserDto.email;

    if (!email) throw new Error('Email không được gửi tới server.');

    const existingUser = await this.usersRepository.findOne({
      where: { email: email },
    });
    if (existingUser)
      throw new HttpException('User already exists', HttpStatus.CONFLICT);

    // Verify role exists if roleId is provided
    if (createUserDto.roleId) {
      await this.rolesService.findOne(createUserDto.roleId);
    }

    const user = this.usersRepository.create({
      ...createUserDto,
      status: createUserDto.status || UserStatus.Active,
      customPermissions: createUserDto.customPermissions || null,
    });
    return this.usersRepository.save(user);
  }

  findOneUser(options: EntityCondition<User>): Promise<NullableType<User>> {
    return this.usersRepository.findOne({
      where: options,
    });
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async findUsersWithPagination(
    options: FindUsersOptions,
  ): Promise<UsersPaginatedResult> {
    const emailTerm = options.email?.trim();
    const nameTerm = options.name?.trim();
    const where: Record<string, unknown> = {};
    const andConditions: Record<string, unknown>[] = [];

    if (emailTerm) {
      where.email = {
        $regex: this.escapeRegex(emailTerm),
        $options: 'i',
      };
    }

    if (nameTerm) {
      where.fullName = {
        $regex: this.escapeRegex(nameTerm),
        $options: 'i',
      };
    }

    if (options.isBlocked !== undefined) {
      where.isBlocked = options.isBlocked;
    }

    // User cũ có thể chưa có field isDeleted, nên coi như false.
    if (options.isDeleted === true) {
      andConditions.push({ isDeleted: true });
    } else {
      andConditions.push({
        $or: [{ isDeleted: false }, { isDeleted: { $exists: false } }],
      });
    }

    if (andConditions.length > 0) {
      where.$and = andConditions;
    }

    const [data, total] = await this.usersRepository.findAndCount({
      where: (Object.keys(where).length > 0 ? where : {}) as never,
      skip: (options.page - 1) * options.limit,
      take: options.limit,
      order: { createdAt: 'DESC' },
    });
    return { data, total };
  }

  async findByEmail(email: string): Promise<User | null> {
    return await this.usersRepository.findOne({
      where: { email: email },
    });
  }

  async updateUser(id: User['id'], payload: DeepPartial<User>): Promise<User> {
    const existingUser = await this.findOneUser({ id });
    if (!existingUser) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    // Verify role exists if roleId is being updated
    if (payload.roleId !== undefined && payload.roleId !== null) {
      await this.rolesService.findOne(payload.roleId);
    }

    const nextPayload: DeepPartial<User> = { ...payload };
    if (nextPayload.isBlocked === true) {
      nextPayload.blockedAt = existingUser.blockedAt ?? new Date();
    }
    if (nextPayload.isBlocked === false) {
      nextPayload.blockedAt = null;
    }
    if (nextPayload.isDeleted === true) {
      nextPayload.status = UserStatus.Inactive;
    }

    Object.assign(existingUser, nextPayload);
    const updatedUser = await this.usersRepository.save(existingUser);
    await this.historyService.create({
      action: HISTORY_ACTIONS.USER_UPDATED,
      message: `Cập nhật người dùng ${existingUser.email}`,
      actorId: existingUser.id,
      actorEmail: existingUser.email ?? undefined,
      targetType: 'user',
      targetId: existingUser.id,
    });
    // Invalidate permission cache for this user so changes take effect immediately
    try {
      this.permissionsService.invalidateCache(existingUser.id);
    } catch (err) {
      // Do not fail the request if cache invalidation fails
    }
    return updatedUser;
  }

  async deleteUser(id: User['id']): Promise<void> {
    const existingUser = await this.findOneUser({ id });
    if (!existingUser) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }
    existingUser.isDeleted = true;
    await this.usersRepository.save(existingUser);
    await this.historyService.create({
      action: HISTORY_ACTIONS.USER_DELETED,
      message: `Xóa người dùng ${existingUser.email}`,
      actorId: existingUser.id,
      actorEmail: existingUser.email ?? undefined,
      targetType: 'user',
      targetId: existingUser.id,
    });
  }

  async saveUser(user: User): Promise<User> {
    return this.usersRepository.save(user);
  }

  async assignRole(userId: string, roleId: string): Promise<User> {
    const user = await this.findOneUser({ id: userId });
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    // Verify role exists
    await this.rolesService.findOne(roleId);

    user.roleId = roleId;
    const updatedUser = await this.usersRepository.save(user);

    await this.historyService.create({
      action: HISTORY_ACTIONS.USER_UPDATED,
      message: `Gán role cho người dùng ${user.email}`,
      actorId: user.id,
      actorEmail: user.email ?? undefined,
      targetType: 'user',
      targetId: user.id,
    });

    try {
      this.permissionsService.invalidateCache(user.id);
    } catch (err) {}

    return updatedUser;
  }

  async removeRole(userId: string): Promise<User> {
    const user = await this.findOneUser({ id: userId });
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    user.roleId = null;
    const updatedUser = await this.usersRepository.save(user);

    await this.historyService.create({
      action: HISTORY_ACTIONS.USER_UPDATED,
      message: `Xóa role của người dùng ${user.email}`,
      actorId: user.id,
      actorEmail: user.email ?? undefined,
      targetType: 'user',
      targetId: user.id,
    });
    try {
      this.permissionsService.invalidateCache(user.id);
    } catch (err) {}

    return updatedUser;
  }
}
