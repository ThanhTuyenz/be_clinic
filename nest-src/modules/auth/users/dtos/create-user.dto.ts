import { Transform } from 'class-transformer';
import { Column } from 'typeorm';

import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  MinLength,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { lowerCaseTransformer } from '../../../../common/utils/transformers/lower-case.transformer';
import { UserRole, UserStatus } from '../entities/user.entity';
import { AuthProvidersEnum } from '../../auth-local/enums/auth-providers.enum';
import { ApiProperty } from '@nestjs/swagger';
import { RolePermissionDto } from '../../../roles/dtos/create-role.dto';

export class CreateUserDto {
  @ApiProperty({ example: 'vuminhduc.contact@gmail.com' })
  @Transform(lowerCaseTransformer)
  @IsNotEmpty()
  @IsEmail()
  email: string | null;

  @ApiProperty({ example: '123456' })
  @MinLength(6)
  password?: string;

  @ApiProperty({ example: 'Vu Minh Duc' })
  @IsNotEmpty()
  fullName: string | null;

  @ApiProperty({ example: UserRole.User, default: UserRole.User })
  @IsNotEmpty()
  @Column({ default: UserRole.User })
  @IsEnum(UserRole, { message: 'Role không hợp lệ' })
  role?: UserRole;

  @ApiProperty({ description: 'Role ID to assign to user', required: false })
  @IsOptional()
  roleId?: string;

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
  provider?: AuthProvidersEnum;
  socialId?: string | null;

  hash?: string | null;
}
