import { Controller, Get, Request } from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { PermissionsService } from './permissions.service.js';
import { Routes } from 'src/common/utils/constants';
import { SkipPermissions } from './decorators/skip-permissions.decorator.js';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION_CATALOG,
  ROLE_DEFAULT_PERMISSIONS,
} from '../../../common/constants/permissions.constant.js';

@ApiTags('Permissions')
@ApiBearerAuth('access-token')
@Controller(Routes.PERMISSIONS)
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get('/catalog')
  @ApiOperation({ summary: 'Danh mục phân quyền y tế chuẩn & quyền mặc định các vai trò' })
  @SkipPermissions()
  getCatalog() {
    return {
      success: true,
      data: {
        catalog: PERMISSION_CATALOG,
        roleDefaults: ROLE_DEFAULT_PERMISSIONS,
      },
    };
  }

  @Get('/me')
  @ApiOperation({ summary: 'Danh sách quyền hiệu lực của người dùng hiện tại' })
  @SkipPermissions()
  async getManyForCurrentUser(@Request() { user }: ExpressRequest) {
    if (!user) {
      throw new Error('User not found in request');
    }

    const result = await this.permissionsService.getUserPermissions(user.id);
    return {
      success: true,
      data: result,
    };
  }
}
