import { TrackingActionType } from '../recommendation.dto.js';
import { Prisma } from '@prisma/client';

export const RECOMMENDATION_PACKAGE_INCLUDE = {
  specialty: { select: { id: true, name: true, slug: true, description: true, symptoms: true } },
} satisfies Prisma.ServicePackageInclude;

export type RecommendationPackage = Prisma.ServicePackageGetPayload<{ include: typeof RECOMMENDATION_PACKAGE_INCLUDE }>;

export interface CandidatePoolItem {
  pkg: RecommendationPackage;
  origin: 'PROFILE' | 'BEHAVIOR' | 'POPULAR';
  behaviorSourceType?: 'SEARCH_INTENT' | 'DROP_OFF' | 'RECENT_VIEW';
  isFollowUp?: boolean;
}

/**
 * ===================================================================================
 * CẤU HÌNH ĐIỂM SỐ & NGƯỠNG HÀNH VI TELEMETRY (Behavior Scoring & Recommendation Config)
 * Gom toàn bộ thông số về 1 nơi để dễ dàng theo dõi & tinh chỉnh thuật toán.
 * ===================================================================================
 */
export const TELEMETRY_CONFIG = {
  // Điểm cộng theo từng hành vi
  ACTION_SCORES: {
    [TrackingActionType.SEARCH]: 3,
    [TrackingActionType.VIEW_PACKAGE]: 2,
    [TrackingActionType.DROP_OFF]: 5,
  },

  // Ngưỡng điểm và giới hạn hành vi
  MIN_QUALIFIED_SCORE: 5, // Ngưỡng kích hoạt tối thiểu 5 điểm (tránh click nhầm 1 lần)
  MAX_SPECIALTY_SCORE_CAP: 15,
  BEHAVIOR_TTL_SECONDS: 14 * 24 * 60 * 60,

  // Giới hạn trích xuất ứng viên hành vi
  MAX_TOP_SPECIALTIES: 3,
  MAX_PACKAGES_PER_SPECIALTY: 3,
  CANDIDATE_POOL_TARGET: 20,
  SEMANTIC_SEARCH_LIMIT: 20,

  // Mỗi nguồn xếp hạng tối đa 20 ứng viên; danh sách cuối tối đa 10 gói.
  CACHE_PREFIX: 'rec:v5:openai',
  SOURCE_PACKAGES_LIMIT: 10,
  HOME_FINAL_PACKAGES_LIMIT: 10,
  POPULARITY_WINDOW_DAYS: 90,
  BEHAVIOR_CACHE_TTL_SECONDS: 24 * 60 * 60,
  RULE_CACHE_TTL_SECONDS: 5 * 60, // Thử lại AI sau lỗi tạm thời, không giữ fallback 7 ngày.
  PROFILE_CACHE_TTL_SECONDS: 7 * 24 * 60 * 60, // 7 ngày cho hồ sơ bệnh án
  RECENCY_SUPPRESSION_DAYS: 90,
  FOLLOW_UP_DEFAULT_DAYS: 180,
} as const;
