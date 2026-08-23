import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

enum GenderDto { MALE = 'MALE', FEMALE = 'FEMALE', OTHER = 'OTHER' }

export class CreatePatientProfileDto {
  @ApiProperty() @IsString() @MaxLength(100) fullName: string;
  @ApiProperty({ example: '2000-01-15' }) @IsDateString() dateOfBirth: string;
  @ApiPropertyOptional({ enum: GenderDto }) @IsOptional() @IsEnum(GenderDto) gender?: GenderDto;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) phoneNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) nationalId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) healthInsuranceNumber?: string;
  
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) provinceCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) provinceName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) districtCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) districtName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) wardCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) wardName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) streetAddress?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) ethnicity?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) nationality?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) occupation?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) guardianName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) guardianPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) guardianRelationship?: string;

  @ApiPropertyOptional({ default: 'SELF' }) @IsOptional() @IsString() @MaxLength(50) relationshipToAccount?: string;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() isMainProfile?: boolean;
}
