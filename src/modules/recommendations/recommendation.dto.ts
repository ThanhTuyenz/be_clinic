export type RecommendationPriority = 'HIGH' | 'MEDIUM' | 'LOW';

export interface RecommendedPackageItemDto {
  packageId: string;
  code: string;
  name: string;
  price: number;
  durationMin?: number;
  specialtyId?: number | null;
  specialtyName: string;
  priority: RecommendationPriority;
  badge: string;
  clinicalReason: string;
}

export interface ProfileRecommendationResponseDto {
  profileId: string;
  profileName?: string;
  updatedAt: string;
  source: 'AI_GEMINI' | 'RULE_FALLBACK' | 'REDIS_CACHE';
  packages: RecommendedPackageItemDto[];
}
