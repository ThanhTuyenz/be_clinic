import { IsDateString, IsIn, IsOptional } from 'class-validator';

export class RecommendationMetricsQueryDto {
  @IsOptional() @IsDateString() start?: string;
  @IsOptional() @IsDateString() end?: string;
  @IsOptional() @IsIn(['today', 'week', 'month', 'quarter', '7days', '30days']) timeFilter?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
}
