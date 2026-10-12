import { Controller, Get, Param, Request } from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { PermissionsService } from './permissions.service.js';
import { Routes } from 'src/common/utils/constants';
import { RequirePermissions, SkipPermissions } from 'src/common/decorators';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  AppPermission,
  PERMISSION_CATALOG,
  ROLE_DEFAULT_PERMISSIONS,
} from './constants/permissions.constant.js';

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

  @Get('/user/:id')
  @ApiOperation({ summary: 'Lấy quyền hạn thực tế và tùy biến của nhân sự theo ID từ DB' })
  @ApiParam({ name: 'id', description: 'UUID của nhân sự' })
  @RequirePermissions(AppPermission.USER_READ)
  async getUserPermissionsById(@Param('id') id: string) {
    this.permissionsService.invalidateCache(id);
    const result = await this.permissionsService.getUserPermissions(id);
    return {
      success: true,
      data: result,
    };
  }
}

