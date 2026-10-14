import { TrackingActionType } from '../recommendation.dto.js';

export interface CandidatePoolItem {
  pkg: any;
  origin: 'PROFILE' | 'BEHAVIOR' | 'BOTH' | 'POPULAR';
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
  CANDIDATE_POOL_TARGET: 8,
  SEMANTIC_SEARCH_LIMIT: 4,

  // Cấu hình điều phối trang chủ (Two-Tower Orchestrator)
  HOME_CANDIDATE_POOL_MIN: 12,
  HOME_CANDIDATE_POOL_MAX: 18,
  HOME_FINAL_PACKAGES_LIMIT: 12,
  HOME_CACHE_TTL_PERSONALIZED: 24 * 60 * 60, // 24 giờ (Cache được xóa tự động tức thì khi có hành vi mới hoặc cập nhật hồ sơ)
  HOME_CACHE_TTL_FALLBACK: 24 * 60 * 60,     // 24 giờ cho khách vãng lai
  PROFILE_CACHE_TTL_SECONDS: 7 * 24 * 60 * 60, // 7 ngày cho hồ sơ bệnh án
  RECENCY_SUPPRESSION_DAYS: 90,
  FOLLOW_UP_DEFAULT_DAYS: 180,
} as const;
