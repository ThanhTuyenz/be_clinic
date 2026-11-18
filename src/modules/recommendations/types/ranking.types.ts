import type { RecommendedPackageItemDto } from '../recommendation.dto.js';

export interface CachedRanking {
  // Both sources validate their current inputs before reusing cached rankings.
  fingerprint?: string;
  updatedAt: string;
  source: 'AI_OPENAI' | 'RULE_FALLBACK' | 'BEHAVIOR_RULES';
  packages: RecommendedPackageItemDto[];
}

export type SourceRanking = CachedRanking & { fromCache: boolean };

