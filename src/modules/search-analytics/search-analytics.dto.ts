import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class AnalyticsInteractionDto {
  @IsUUID() id: string;
  @IsOptional() @IsDateString() occurredAt?: string;
  @IsString() @MinLength(16) @MaxLength(100) sessionId: string;
  @IsOptional() @IsUUID() searchId?: string;
  @IsIn(['RESULT_CLICK', 'PACKAGE_VIEW']) eventType: 'RESULT_CLICK' | 'PACKAGE_VIEW';
  @IsIn(['PACKAGE', 'DOCTOR', 'BRANCH']) targetType: 'PACKAGE' | 'DOCTOR' | 'BRANCH';
  @IsUUID() targetId: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) position?: number;
  @IsOptional() @IsUUID() branchId?: string;
}
