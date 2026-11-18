import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';

export class AnalyticsInteractionDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) id?: number;
  @IsOptional() @IsDateString() occurredAt?: string;
  @IsString() @MinLength(16) @MaxLength(100) sessionId: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) searchId?: number;
  @IsIn(['RESULT_CLICK', 'PACKAGE_VIEW', 'RECOMMEND_IMPRESSION', 'RECOMMEND_CLICK'])
  eventType: 'RESULT_CLICK' | 'PACKAGE_VIEW' | 'RECOMMEND_IMPRESSION' | 'RECOMMEND_CLICK';
  @IsOptional() @IsString() @MaxLength(10000) recommendationToken?: string;
  @IsIn(['PACKAGE', 'DOCTOR', 'BRANCH']) targetType: 'PACKAGE' | 'DOCTOR' | 'BRANCH';
  @ValidateIf(dto => dto.targetType !== 'DOCTOR' || dto.targetId != null)
  @Type(() => Number) @IsInt() @Min(1) targetId?: number;
  @ValidateIf(dto => dto.targetType === 'DOCTOR' || dto.targetDoctorId != null)
  @IsUUID() targetDoctorId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) position?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) branchId?: number;
}
