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
import { RolePermissionDto } from './role-permission.dto';

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
    description: 'Custom permissions for user ({ granted?: string[], revoked?: string[] } or array)',
  })
  @IsOptional()
  customPermissions?: any;

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

  @ApiPropertyOptional({ example: '0901234567' })
  @IsOptional()
  phoneNumber?: string | null;

  @ApiPropertyOptional({ description: 'URL ảnh đại diện' })
  @IsOptional()
  avatarUrl?: string | null;

  @ApiPropertyOptional({ description: 'ID cơ sở làm việc' })
  @IsOptional()
  branchId?: string | null;

  @ApiPropertyOptional({ description: 'Danh sách ID cơ sở làm việc / quản lý', type: [String] })
  @IsOptional()
  @IsArray()
  branchIds?: string[];

  @ApiPropertyOptional({ description: 'ID cơ sở chính' })
  @IsOptional()
  primaryBranchId?: string | null;

  @ApiPropertyOptional({ description: 'ID chuyên khoa chính (Bác sĩ)' })
  @IsOptional()
  specialtyId?: number | null;

  @ApiPropertyOptional({ description: 'ID phòng khám phụ trách' })
  @IsOptional()
  roomId?: string | null;

  @ApiPropertyOptional({ example: 'BS. CKI' })
  @IsOptional()
  academicRank?: string | null;

  @ApiPropertyOptional({ example: 'CCHN-12345' })
  @IsOptional()
  licenseNumber?: string | null;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  experienceYears?: number | null;

  @ApiPropertyOptional({ example: 250000 })
  @IsOptional()
  consultationFee?: number | null;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  slotDuration?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  isFeatured?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  biography?: string | null;
}
