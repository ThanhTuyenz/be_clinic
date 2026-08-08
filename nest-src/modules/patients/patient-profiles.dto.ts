import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

enum GenderDto { MALE = 'MALE', FEMALE = 'FEMALE', OTHER = 'OTHER' }

export class CreatePatientProfileDto {
  @ApiProperty() @IsString() @MaxLength(100) fullName: string;
  @ApiProperty({ example: '2000-01-15' }) @IsDateString() dateOfBirth: string;
  @ApiPropertyOptional({ enum: GenderDto }) @IsOptional() @IsEnum(GenderDto) gender?: GenderDto;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) nationalId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional({ default: 'SELF' }) @IsOptional() @IsString() @MaxLength(50) relationshipToAccount?: string;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() isMainProfile?: boolean;
}
