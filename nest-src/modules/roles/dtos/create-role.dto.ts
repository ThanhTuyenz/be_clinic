import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString } from 'class-validator'

export class RolePermissionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  resource?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  action?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  target?: string
}
