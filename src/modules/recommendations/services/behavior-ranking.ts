import type { BehaviorCandidate } from './candidate-retrieval.service.js';
import type { RecommendedPackageItemDto } from '../recommendation.dto.js';
import { TELEMETRY_CONFIG } from '../constants/recommendation.constants.js';

export function rankBehaviorCandidates(candidates: BehaviorCandidate[], now = Date.now()): RecommendedPackageItemDto[] {
  const ranked = new Map<string, { candidate: BehaviorCandidate; score: number; strongest: number; latest: number }>();

  const at = (item: BehaviorCandidate) => item.abandonedAt ?? item.searchedAt ?? item.lastViewedAt ?? 0;

  for (const candidate of candidates) {
    const timestamp = at(candidate);
    if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > now
      || now - timestamp > TELEMETRY_CONFIG.BEHAVIOR_TTL_SECONDS * 1000) continue;

    const decay = 2 ** (-(now - timestamp) / (6 * 3600000));
    const views = Math.max(1, candidate.viewCount || 1);
    const weight = candidate.sourceType === 'DROP_OFF' ? 5
      : candidate.sourceType === 'SEARCH_INTENT' ? 3 / Math.sqrt(1 + (candidate.searchRank ?? 0))
        : Math.min(8, 2 + (views - 1)); 

    const score = weight * decay;


    const previous = ranked.get(candidate.pkg.id);
    if (previous) {
      previous.score += score;
      previous.latest = Math.max(previous.latest, timestamp);
      if (score > previous.strongest) {
        previous.candidate = candidate;
        previous.strongest = score;
      }
    } else ranked.set(candidate.pkg.id, { candidate, score, strongest: score, latest: timestamp });
  }
  const sorted = [...ranked.values()].sort((a, b) => b.score - a.score || b.latest - a.latest
    || a.candidate.pkg.id.localeCompare(b.candidate.pkg.id));
  const selected = new Set<string>();

  candidates.filter(item => item.sourceType === 'RECENT_VIEW' && ranked.has(item.pkg.id))
    .sort((a, b) => at(b) - at(a) || a.pkg.id.localeCompare(b.pkg.id)).slice(0, 3)
    .forEach(item => selected.add(item.pkg.id));
  for (const item of sorted) {
    if (selected.size >= TELEMETRY_CONFIG.SOURCE_PACKAGES_LIMIT) break;
    selected.add(item.candidate.pkg.id);
  }
  return sorted.filter(item => selected.has(item.candidate.pkg.id)).map(({ candidate }, index) => {
    const pkg = candidate.pkg;
    const badge = candidate.sourceType === 'DROP_OFF' ? 'Tiếp tục đăng ký'
      : candidate.sourceType === 'SEARCH_INTENT' ? 'Phù hợp tìm kiếm' : 'Đã xem gần đây';
    const clinicalReason = candidate.sourceType === 'DROP_OFF'
      ? 'Tài khoản từng bắt đầu đặt gói này nhưng chưa hoàn tất thanh toán.'
      : candidate.sourceType === 'SEARCH_INTENT'
        ? `Gói khám xuất hiện trong kết quả tìm kiếm gần đây: “${(candidate.searchQuery || '').slice(0, 180)}”.`
        : `Tài khoản đã xem gói khám này ${candidate.viewCount || 1} lần gần đây.`;
    return {
      packageId: pkg.id, code: pkg.code, slug: pkg.slug || undefined, name: pkg.name,
      price: Number(pkg.price), durationMin: pkg.durationMin, specialtyId: pkg.specialtyId,
      specialtyName: pkg.specialty?.name || 'Đa khoa', priority: index === 0 ? 'HIGH' : 'MEDIUM',
      sourceType: candidate.sourceType, badge, clinicalReason,
    };
  });
}
