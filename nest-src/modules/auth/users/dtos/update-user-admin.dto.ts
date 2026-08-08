import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
  IsArray,
  ValidateNested,
} from 'class-validator';

import { lowerCaseTransformer } from 'src/common/utils/transformers/lower-case.transformer';

import { UserRole, UserStatus } from '../entities/user.entity';
import { RolePermissionDto } from '../../../roles/dtos/create-role.dto';

export class UpdateUserAdminDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(lowerCaseTransformer)
  @IsEmail()
  email?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fullName?: string | null;

  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole, { message: 'Role không hợp lệ' })
  role?: UserRole;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus, { message: 'Trạng thái không hợp lệ' })
  status?: UserStatus;

  @ApiPropertyOptional({ description: 'Role ID to assign to user' })
  @IsOptional()
  @IsString()
  roleId?: string | null;

  @ApiPropertyOptional({
    description: 'Custom permissions for user',
    type: [RolePermissionDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RolePermissionDto)
  customPermissions?: RolePermissionDto[] | null;

  @ApiPropertyOptional({ description: 'Đặt mật khẩu mới (admin)' })
  @IsOptional()
  @MinLength(6)
  password?: string;

  @ApiPropertyOptional({
    description: 'Khóa tài khoản người dùng',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isBlocked?: boolean;

  @ApiPropertyOptional({
    description: 'Đánh dấu tài khoản đã xóa mềm',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isDeleted?: boolean;
}
