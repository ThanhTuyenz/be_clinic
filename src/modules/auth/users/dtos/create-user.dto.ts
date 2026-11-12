import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  MinLength,
  IsArray,
  ValidateNested,
  IsNumber,
  IsInt,
  IsBoolean,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

import { lowerCaseTransformer } from '../../../../common/utils/transformers/lower-case.transformer';
import { UserRole, UserStatus } from '../entities/user.entity';
import { ApiProperty } from '@nestjs/swagger';
import { RolePermissionDto } from './role-permission.dto';
import { DoctorProfileDto } from './doctor-profile.dto';

export class CreateUserDto extends DoctorProfileDto {
  @ApiProperty({ example: 'doctor@vitacare.local' })
  @Transform(lowerCaseTransformer)
  @IsNotEmpty()
  @IsEmail()
  email: string | null;

  @ApiProperty({ example: '123456' })
  @MinLength(6)
  password?: string;

  @ApiProperty({ example: 'BS. Nguyễn Văn An' })
  @IsNotEmpty()
  fullName: string | null;

  @ApiProperty({ example: UserRole.Patient, default: UserRole.Patient })
  @IsNotEmpty()
  @IsEnum(UserRole, { message: 'Role không hợp lệ' })
  role?: UserRole;

  @ApiProperty({
    description: 'Custom permissions for user',
    required: false,
    type: [RolePermissionDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RolePermissionDto)
  customPermissions?: RolePermissionDto[];

  status?: UserStatus;

  hash?: string | null;

  @ApiProperty({ example: '0901234567', required: false })
  @IsOptional()
  phoneNumber?: string | null;

  @ApiProperty({ description: 'URL ảnh đại diện', required: false })
  @IsOptional()
  avatarUrl?: string | null;

  @ApiProperty({ description: 'ID cơ sở làm việc', required: false })
  @IsOptional()
  branchId?: string | null;

  @ApiProperty({ description: 'ID chuyên khoa chính (Bác sĩ)', required: false })
  @IsOptional()
  specialtyId?: number | null;

  @ApiProperty({ example: 'BS. CKI', required: false })
  @IsOptional()
  academicRank?: string | null;

  @ApiProperty({ example: 'CCHN-12345', required: false })
  @IsOptional()
  licenseNumber?: string | null;

  @ApiProperty({ example: 5, required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  experienceYears?: number | null;

  @ApiProperty({ example: 250000, required: false })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999.99)
  consultationFee?: number | null;

  @ApiProperty({ example: 30, required: false })
  @IsOptional()
  slotDuration?: number | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  biography?: string | null;
}
