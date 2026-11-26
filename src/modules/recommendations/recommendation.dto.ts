import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

export interface RecommendedPackageItemDto {
  packageId: number;
  code: string;
  slug?: string;
  name: string;
  price: number;
  durationMin?: number;
  specialtyId?: number | null;
  specialtyName: string;
  badge: string;
  clinicalReason: string;
  sourceType?: 'DROP_OFF' | 'SEARCH_INTENT' | 'RECENT_VIEW' | 'PROFILE_AI';
}

export interface ProfileRecommendationResponseDto {
  profileId: string;
  profileName?: string;
  updatedAt: string;
  source: 'AI_OPENAI' | 'RULE_FALLBACK' | 'REDIS_CACHE';
  event?: string;
  triggerEvent?: string;
  triggerReason?: string;
  packages: RecommendedPackageItemDto[];
}

export enum TrackingActionType {
  SEARCH = 'SEARCH',
  VIEW_PACKAGE = 'VIEW_PACKAGE',
  DROP_OFF = 'DROP_OFF',
}

export class TrackBehaviorDto {
  @IsString()
  @IsNotEmpty({ message: 'sessionId không được để trống' })
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: 'sessionId không hợp lệ' })
  sessionId: string;

  @IsIn([TrackingActionType.VIEW_PACKAGE], { message: 'Client chỉ được ghi nhận lượt xem gói khám' })
  actionType: TrackingActionType;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  targetPackageId?: number;

}

export class RecommendationSessionQueryDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: 'sessionId không hợp lệ' })
  sessionId?: string;
}

export interface RecommendationSectionDto {
  status: 'READY' | 'EMPTY' | 'PENDING';
  updatedAt: string;
  fromCache: boolean;
  packages: RecommendedPackageItemDto[];
}

export interface ProfileRecommendationSectionDto extends RecommendationSectionDto {
  profileId: string;
  profileName?: string;
}

