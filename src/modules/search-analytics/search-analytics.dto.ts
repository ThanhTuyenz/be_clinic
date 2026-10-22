import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class AnalyticsInteractionDto {
  @IsUUID() id: string;
  @IsOptional() @IsDateString() occurredAt?: string;
  @IsString() @MinLength(16) @MaxLength(100) sessionId: string;
  @IsOptional() @IsUUID() searchId?: string;
  @IsIn(['RESULT_CLICK', 'PACKAGE_VIEW', 'RECOMMEND_IMPRESSION', 'RECOMMEND_CLICK'])
  eventType: 'RESULT_CLICK' | 'PACKAGE_VIEW' | 'RECOMMEND_IMPRESSION' | 'RECOMMEND_CLICK';
  @IsOptional() @IsString() @MaxLength(10000) recommendationToken?: string;
  @IsIn(['PACKAGE', 'DOCTOR', 'BRANCH']) targetType: 'PACKAGE' | 'DOCTOR' | 'BRANCH';
  @IsUUID() targetId: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) position?: number;
  @IsOptional() @IsUUID() branchId?: string;
}

export class RecommendationMetricsQueryDto {
  @IsOptional() @IsDateString() start?: string;
  @IsOptional() @IsDateString() end?: string;
}
