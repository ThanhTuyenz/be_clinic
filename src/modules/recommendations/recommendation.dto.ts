import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

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
  sourceType?: 'DROP_OFF' | 'SEARCH_INTENT' | 'RECENT_VIEW' | 'PROFILE_AI' | 'POPULAR';
}

export interface ProfileRecommendationResponseDto {
  profileId: string;
  profileName?: string;
  updatedAt: string;
  source: 'AI_GEMINI' | 'RULE_FALLBACK' | 'REDIS_CACHE';
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
  sessionId: string;

  @IsEnum(TrackingActionType, { message: 'actionType không hợp lệ' })
  actionType: TrackingActionType;

  @IsNumber()
  @IsOptional()
  targetSpecialtyId?: number;

  @IsString()
  @IsOptional()
  targetPackageId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  searchQuery?: string;
}

export class HomeRecommendationQueryDto {
  @IsString()
  @IsOptional()
  sessionId?: string;

  @IsString()
  @IsOptional()
  profileId?: string;

  @IsString()
  @IsOptional()
  branchId?: string;
}

export interface HomeRecommendationResponseDto {
  profileId?: string;
  profileName?: string;
  updatedAt: string;
  source: 'HYBRID' | 'AI_PROFILE' | 'BEHAVIOR' | 'FALLBACK';
  event?: string;
  triggerEvent?: string;
  triggerReason?: string;
  dataOrigin: 'CACHE' | 'NEW';
  isCached: boolean;
  fromCache: boolean;
  packages: RecommendedPackageItemDto[];
}
