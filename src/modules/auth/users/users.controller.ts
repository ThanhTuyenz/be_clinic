import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PermissionsService } from '../permissions/permissions.service';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { RequirePermissions } from 'src/common/decorators/require-permissions.decorator';
import { AppPermission } from 'src/common/constants/permissions.constant';
import { Routes, Services } from 'src/common/utils/constants';

import { CreateUserDto } from './dtos/create-user.dto';
import { UpdateUserAdminDto } from './dtos/update-user-admin.dto';
import { UsersPaginationQueryDto } from './dtos/users-pagination-query.dto';
import { AssignRoleDto } from './dtos/assign-role.dto';
import { IUsersService } from './users';
import { RolePermissionDto } from './dtos/role-permission.dto';

@ApiTags('Users')
@Controller(Routes.USERS)
export class UsersController {
  constructor(
    @Inject(Services.USERS) private readonly usersService: IUsersService,
    private readonly permissions: PermissionsService,
  ) { }

  @Post()
  @RequirePermissions(AppPermission.USER_CREATE)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Tạo mới người dùng (admin)' })
  async create(@Req() request: Request, @Body() createUserDto: CreateUserDto) {
    if (['admin', 'chain_manager', 'branch_manager'].includes(String(createUserDto.role).toLowerCase()) || createUserDto.roleId !== undefined || createUserDto.customPermissions !== undefined) {
      await this.requireAdditional(request.user!.id, AppPermission.ROLE_MANAGE);
    }
    return this.usersService.createUser(createUserDto);
  }

  @Get()
  @RequirePermissions(AppPermission.USER_READ)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary:
      'Danh sách người dùng (phân trang, admin; lọc tùy chọn theo email, họ tên)',
  })
  findAll(@Query() query: UsersPaginationQueryDto) {
    return this.usersService.findUsersWithPagination({
      page: query.page,
      limit: query.limit,
      email: query.email,
      name: query.name,
      isBlocked: query.isBlocked,
      isDeleted: query.isDeleted,
    });
  }

  @Patch(':id')
  @RequirePermissions(AppPermission.USER_UPDATE)
  @ApiBearerAuth('access-token')
  @ApiParam({ name: 'id', description: 'UUID người dùng' })
  @ApiOperation({ summary: 'Cập nhật người dùng (admin)' })
  async update(@Req() request: Request, @Param('id') id: string, @Body() updateUserDto: UpdateUserAdminDto) {
    if (updateUserDto.customPermissions !== undefined || updateUserDto.roleId !== undefined) {
      await this.requireAdditional(request.user!.id, AppPermission.ROLE_MANAGE);
    }
    if (updateUserDto.role !== undefined) {
      const existing = await this.usersService.findOneUser({ id });
      if (String(existing?.role).toLowerCase() !== String(updateUserDto.role).toLowerCase()) await this.requireAdditional(request.user!.id, AppPermission.ROLE_MANAGE);
    }
    if (updateUserDto.isDeleted !== undefined) await this.requireAdditional(request.user!.id, AppPermission.USER_DELETE);
    return this.usersService.updateUser(id, updateUserDto);
  }

  @Delete(':id')
  @RequirePermissions(AppPermission.USER_DELETE)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', description: 'UUID người dùng' })
  @ApiOperation({ summary: 'Xóa mềm người dùng (admin)' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.usersService.deleteUser(id);
  }

  @Patch(':id/role')
  @RequirePermissions(AppPermission.ROLE_MANAGE)
  @ApiBearerAuth('access-token')
  @ApiParam({ name: 'id', description: 'UUID người dùng' })
  @ApiOperation({ summary: 'Gán role cho người dùng (admin)' })
  assignRole(@Param('id') id: string, @Body() assignRoleDto: AssignRoleDto) {
    return this.usersService.assignRole(id, assignRoleDto.roleId);
  }

  @Delete(':id/role')
  @RequirePermissions(AppPermission.ROLE_MANAGE)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', description: 'UUID người dùng' })
  @ApiOperation({ summary: 'Xóa role của người dùng (admin)' })
  async removeRole(@Param('id') id: string): Promise<void> {
    await this.usersService.removeRole(id);
  }

  @Post(':id/permissions')
  @RequirePermissions(AppPermission.ROLE_MANAGE)
  @ApiBearerAuth('access-token')
  @ApiParam({ name: 'id', description: 'UUID người dùng' })
  @ApiOperation({ summary: 'Gán quyền tùy chỉnh cho người dùng (admin)' })
  assignCustomPermissions(
    @Param('id') id: string,
    @Body() permissions: RolePermissionDto[],
  ) {
    return this.usersService.updateUser(id, { customPermissions: permissions });
  }

  @Delete(':id/permissions')
  @RequirePermissions(AppPermission.ROLE_MANAGE)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', description: 'UUID người dùng' })
  @ApiOperation({ summary: 'Xóa quyền tùy chỉnh của người dùng (admin)' })
  async removeCustomPermissions(@Param('id') id: string): Promise<void> {
    await this.usersService.updateUser(id, { customPermissions: null });
  }
  private async requireAdditional(userId: string, permission: AppPermission) {
    const result = await this.permissions.getUserPermissions(userId);
    if (!result.effectivePermissions.includes(permission)) throw new ForbiddenException('Bạn không có quyền thay đổi vai trò, phân quyền hoặc trạng thái xóa tài khoản');
  }
}
