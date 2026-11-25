import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { EmbeddingService, type PackageForRetrieval, type ScoredPackage } from '../../../infrastructure/embedding/embedding.service.js';
import { matchesSearchConstraints, matchesSearchExclusions, parseSearchIntent, searchTextScore, searchTypoScore } from '../../../common/utils/search-query.js';

/** Search policy lives here; recommendation retrieval never calls this service. */
@Injectable()
export class SearchRankingService {
  private readonly logger = new Logger(SearchRankingService.name);
  private readonly rankWindow = 50;
  private readonly rrfConstant = 60;

  constructor(private readonly embedding: EmbeddingService) {}

  async rank(query: string, packages: PackageForRetrieval[], limit = 10, options: { semantic?: boolean } = {}): Promise<ScoredPackage[]> {
    const intent = parseSearchIntent(query);
    if ((!intent.text && !intent.hasConstraints) || !packages.length) return [];
    const candidates = packages.filter(pkg => matchesSearchConstraints(intent, pkg)
      && matchesSearchExclusions(intent, [pkg.name, pkg.code, pkg.specialtyName, pkg.description, ...(pkg.symptoms || [])]));
    if (!candidates.length) return [];
    const keyword = candidates.map(pkg => ({ package: pkg, score: intent.text
      ? Math.max(searchTextScore(intent.text, pkg.name), searchTextScore(intent.text, pkg.specialtyName)) : 1 }));
    if (intent.text && !keyword.some(item => item.score > 0)) {
      for (const item of keyword) item.score = Math.max(searchTypoScore(intent.text, item.package.name), searchTypoScore(intent.text, item.package.specialtyName));
    }
    const tieBreak = (a: PackageForRetrieval, b: PackageForRetrieval) =>
      (intent.followUp === undefined ? Number(Boolean(a.isFollowUp)) - Number(Boolean(b.isFollowUp)) : 0)
      || a.price - b.price || a.id - b.id;
    const lexical = keyword.filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || tieBreak(a.package, b.package));
    let semantic: ScoredPackage[] = [];
    if (intent.text && options.semantic !== false) {
      let hits: ScoredPackage[] | null = null;
      try {
        const vector = await this.embedding.embedSearchQuery(query);
        if (vector) hits = await this.embedding.retrieveVectorCandidates(vector, candidates, Math.min(this.rankWindow, candidates.length));
      } catch { /* Keep usable lexical results during a vector outage. */ }
      if (hits === null && !lexical.length) throw new ServiceUnavailableException('Không thể tải kết quả tìm kiếm. Vui lòng thử lại.');
      if (hits === null) this.logger.debug('Vector search unavailable; returning keyword matches.');
      const eligible = new Map(candidates.map(pkg => [pkg.id, pkg]));
      semantic = (hits || []).filter(hit => eligible.has(hit.package.id) && Number.isFinite(hit.score))
        .map(hit => ({ ...hit, package: eligible.get(hit.package.id)! }))
        .sort((a, b) => b.score - a.score || tieBreak(a.package, b.package));
    }
    // Preserve the keyword-only baseline and constraint-only browsing.
    if (options.semantic === false || !intent.text) return lexical.slice(0, limit);

    // Reciprocal rank fusion: each distinct package contributes once per retriever.
    const fused = new Map<number, ScoredPackage>();
    for (const ranking of [lexical, semantic]) {
      const seen = new Set<number>();
      let rank = 0;
      for (const item of ranking) {
        if (seen.has(item.package.id)) continue;
        seen.add(item.package.id);
        if (++rank > this.rankWindow) break;
        const score = (fused.get(item.package.id)?.score || 0) + 1 / (this.rrfConstant + rank);
        fused.set(item.package.id, { package: item.package, score });
      }
    }
    return [...fused.values()]
      .sort((a, b) => b.score - a.score || tieBreak(a.package, b.package))
      .slice(0, limit);
  }
}
