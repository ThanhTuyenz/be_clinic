import { Injectable, NotFoundException, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from '../auth/users/entities/user.entity';
import { Services } from 'src/common/utils/constants';
import { IRolesService } from '../roles/roles';

import { PermissionRole, mapUserRoleToPermissionRole } from './enums';
import { generateGlobalPermissions } from './permissions.helpers';
import { Permission } from './types/permission.type';
import { PermissionsCacheService } from './services/permissions-cache.service';

@Injectable()
export class PermissionsService {
  private readonly logger = new Logger(PermissionsService.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly cacheService: PermissionsCacheService,
    @Inject(Services.ROLES)
    private readonly rolesService: IRolesService,
  ) {}

  async getMany(
    userId: string,
  ): Promise<{ role: PermissionRole; permissions: Permission[] }> {
    // Check cache first
    const cached = this.cacheService.get(userId);
    if (cached) {
      this.logger.debug(`Returning cached permissions for user ${userId}`);
      return { role: cached.role, permissions: cached.permissions };
    }

    const permissions: Permission[] = [];

    const user = await this.usersRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      this.logger.warn(`User not found: ${userId}`);
      throw new NotFoundException('User not found');
    }

    if (user.isDeleted) {
      this.logger.warn(`User is deleted: ${userId}`);
      throw new NotFoundException('User has been deleted');
    }

    if (user.isBlocked) {
      this.logger.warn(`User is blocked: ${userId}`);
      throw new NotFoundException('User has been blocked');
    }

    const permissionRole = mapUserRoleToPermissionRole(user.role);

    if (user.roleId) {
      try {
        const role = await this.rolesService.findOne(user.roleId);
        this.logger.log(`Found role ${role.id} with ${role.permissions?.length || 0} permissions`);
        if (role.permissions?.length) {
          permissions.push(...(role.permissions as unknown as Permission[]));
        }
      } catch (error) {
        this.logger.warn(
          `Unable to load role ${user.roleId} for user ${userId}, falling back to global role permissions`,
        );
      }
    }

    if (user.customPermissions?.length) {
      this.logger.log(`Found custom permissions with length ${user.customPermissions.length}`);
      permissions.push(...(user.customPermissions as unknown as Permission[]));
    }

    if (!permissions.length) {
      this.logger.log(`No role or custom permissions found, using global permissions for ${permissionRole}`);
      permissions.push(...generateGlobalPermissions(permissionRole));
    }

    // Cache the result
    this.cacheService.set(userId, permissionRole, permissions);

    return { role: permissionRole, permissions };
  }

  /**
   * Invalidate cache for a specific user
   * Call this when user permissions change (role update, etc.)
   */
  invalidateCache(userId: string): void {
    this.cacheService.invalidate(userId);
    this.logger.log(`Invalidated permission cache for user ${userId}`);
  }

  /**
   * Invalidate all cached permissions
   * Call this when global permission rules change
   */
  invalidateAllCache(): void {
    this.cacheService.invalidateAll();
    this.logger.log('Invalidated all permission caches');
  }
}
