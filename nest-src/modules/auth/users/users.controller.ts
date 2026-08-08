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
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import {
  RequiresPermission,
  PermissionAction,
  PermissionResource,
  PermissionResourceTarget,
} from '../../permissions/decorators/permissions.decorator';
import { Routes, Services } from 'src/common/utils/constants';

import { CreateUserDto } from './dtos/create-user.dto';
import { UpdateUserAdminDto } from './dtos/update-user-admin.dto';
import { UsersPaginationQueryDto } from './dtos/users-pagination-query.dto';
import { AssignRoleDto } from './dtos/assign-role.dto';
import { IUsersService } from './users';
import { RolePermissionDto } from '../../roles/dtos/create-role.dto';

@ApiTags('Users')
@Controller(Routes.USERS)
export class UsersController {
  constructor(
    @Inject(Services.USERS) private readonly usersService: IUsersService,
  ) {}

  @Post()
  @RequiresPermission(
    PermissionResource.USER,
    PermissionAction.CREATE,
    PermissionResourceTarget.ANY,
  )
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Tạo mới người dùng (admin)' })
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.createUser(createUserDto);
  }

  @Get()
  @RequiresPermission(
    PermissionResource.USER,
    PermissionAction.GET,
    PermissionResourceTarget.ANY,
  )
  @ApiBearerAuth()
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
  @RequiresPermission(
    PermissionResource.USER,
    PermissionAction.EDIT,
    PermissionResourceTarget.ANY,
  )
  @ApiBearerAuth()
  @ApiParam({ name: 'id', description: 'UUID người dùng' })
  @ApiOperation({ summary: 'Cập nhật người dùng (admin)' })
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserAdminDto) {
    return this.usersService.updateUser(id, updateUserDto);
  }

  @Delete(':id')
  @RequiresPermission(
    PermissionResource.USER,
    PermissionAction.DELETE,
    PermissionResourceTarget.ANY,
  )
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', description: 'UUID người dùng' })
  @ApiOperation({ summary: 'Xóa mềm người dùng (admin)' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.usersService.deleteUser(id);
  }

  @Patch(':id/role')
  @RequiresPermission(
    PermissionResource.USER,
    PermissionAction.EDIT,
    PermissionResourceTarget.ANY,
  )
  @ApiBearerAuth()
  @ApiParam({ name: 'id', description: 'UUID người dùng' })
  @ApiOperation({ summary: 'Gán role cho người dùng (admin)' })
  assignRole(@Param('id') id: string, @Body() assignRoleDto: AssignRoleDto) {
    return this.usersService.assignRole(id, assignRoleDto.roleId);
  }

  @Delete(':id/role')
  @RequiresPermission(
    PermissionResource.USER,
    PermissionAction.EDIT,
    PermissionResourceTarget.ANY,
  )
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', description: 'UUID người dùng' })
  @ApiOperation({ summary: 'Xóa role của người dùng (admin)' })
  async removeRole(@Param('id') id: string): Promise<void> {
    await this.usersService.removeRole(id);
  }

  @Post(':id/permissions')
  @RequiresPermission(
    PermissionResource.USER,
    PermissionAction.EDIT,
    PermissionResourceTarget.ANY,
  )
  @ApiBearerAuth()
  @ApiParam({ name: 'id', description: 'UUID người dùng' })
  @ApiOperation({ summary: 'Gán quyền tùy chỉnh cho người dùng (admin)' })
  assignCustomPermissions(
    @Param('id') id: string,
    @Body() permissions: RolePermissionDto[],
  ) {
    return this.usersService.updateUser(id, { customPermissions: permissions });
  }

  @Delete(':id/permissions')
  @RequiresPermission(
    PermissionResource.USER,
    PermissionAction.EDIT,
    PermissionResourceTarget.ANY,
  )
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', description: 'UUID người dùng' })
  @ApiOperation({ summary: 'Xóa quyền tùy chỉnh của người dùng (admin)' })
  async removeCustomPermissions(@Param('id') id: string): Promise<void> {
    await this.usersService.updateUser(id, { customPermissions: null });
  }
}
