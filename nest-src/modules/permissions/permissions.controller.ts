import { Controller, Get, Request } from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { PermissionsService } from './permissions.service';
import { Permission } from './types/permission.type';
import { Routes } from 'src/common/utils/constants';
import { SkipPermissions } from './decorators/skip-permissions.decorator';

@Controller(Routes.PERMISSIONS)
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get('/me')
  @SkipPermissions()
  async getManyForCurrentUser(
    @Request() { user }: ExpressRequest,
  ): Promise<Permission[]> {
    if (!user) {
      throw new Error('User not found in request');
    }

    const { permissions } = await this.permissionsService.getMany(user.id);
    return permissions;
  }
}
