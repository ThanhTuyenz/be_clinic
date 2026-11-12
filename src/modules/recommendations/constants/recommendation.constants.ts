import { Prisma } from '@prisma/client';

export const RECOMMENDATION_PACKAGE_INCLUDE = {
  specialty: { select: { id: true, name: true, slug: true, description: true, symptoms: true } },
} satisfies Prisma.ServicePackageInclude;

export type RecommendationPackage = Prisma.ServicePackageGetPayload<{ include: typeof RECOMMENDATION_PACKAGE_INCLUDE }>;

export interface CandidatePoolItem {
  pkg: RecommendationPackage;
  origin: 'PROFILE' | 'BEHAVIOR';
  behaviorSourceType?: 'SEARCH_INTENT' | 'DROP_OFF' | 'RECENT_VIEW';
  retrievalScore?: number;
  evidenceSignals?: string[];
  viewCount?: number;
  lastViewedAt?: number;
  searchQuery?: string;
  searchedAt?: number;
  abandonedAt?: number;
}

/**
 * ===================================================================================
 * CẤU HÌNH ĐIỂM SỐ & NGƯỠNG HÀNH VI TELEMETRY (Behavior Scoring & Recommendation Config)
 * Gom toàn bộ thông số về 1 nơi để dễ dàng theo dõi & tinh chỉnh thuật toán.
 * ===================================================================================
 */
export const TELEMETRY_CONFIG = {
  // Ngưỡng điểm và giới hạn hành vi
  BEHAVIOR_TTL_SECONDS: 14 * 24 * 60 * 60,

  // Giới hạn trích xuất ứng viên hành vi
  CANDIDATE_POOL_TARGET: 20,
  SEMANTIC_SEARCH_LIMIT: 20,

  // Mỗi nguồn xếp hạng tối đa 20 ứng viên và trả riêng tối đa 10 gói.
  CACHE_PREFIX: 'rec:v7:account',
  POLICY_VERSION: 'grounded-independent-account-v5-routine-checkups',
  MAX_RECENT_PACKAGE_VIEWS: 50,
  MAX_RECENT_SEARCHES: 5,
  MAX_RECENT_DROP_OFFS: 3,
  SOURCE_PACKAGES_LIMIT: 10,
  BEHAVIOR_CACHE_TTL_SECONDS: 24 * 60 * 60,
  RULE_CACHE_TTL_SECONDS: 5 * 60, // Thử lại AI sau lỗi tạm thời, không giữ fallback 7 ngày.
  PROFILE_CACHE_TTL_SECONDS: 7 * 24 * 60 * 60, // 7 ngày cho hồ sơ bệnh án
  RECENCY_SUPPRESSION_DAYS: 90,
} as const;
