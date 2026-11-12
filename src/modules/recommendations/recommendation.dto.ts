import { IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export type RecommendationPriority = 'HIGH' | 'MEDIUM' | 'LOW';

export interface RecommendedPackageItemDto {
  packageId: string;
  code: string;
  slug?: string;
  name: string;
  price: number;
  durationMin?: number;
  specialtyId?: number | null;
  specialtyName: string;
  priority: RecommendationPriority;
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

  @IsString()
  @IsOptional()
  targetPackageId?: string;

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
  trackingToken?: string;
}

export interface ProfileRecommendationSectionDto extends RecommendationSectionDto {
  profileId: string;
  profileName?: string;
}

