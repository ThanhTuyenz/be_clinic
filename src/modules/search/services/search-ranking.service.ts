import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { EmbeddingService, type PackageForRetrieval, type ScoredPackage } from '../../../infrastructure/embedding/embedding.service.js';
import { matchesSearchConstraints, matchesSearchExclusions, normalizeSearch, parseSearchIntent, searchTextScore, searchTypoScore } from '../../../common/utils/search-query.js';

/** Each document contributes at most once per retriever. Rank starts at one. */
function reciprocalRankFusion(lists: string[][], constant = 60): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) [...new Set(list)].forEach((id, index) =>
    scores.set(id, (scores.get(id) || 0) + 1 / (constant + index + 1)));
  return scores;
}

/** Search policy lives here; recommendation retrieval never calls this service. */
@Injectable()
export class SearchRankingService {
  private readonly logger = new Logger(SearchRankingService.name);
  private readonly minSimilarity = 0.82;
  private readonly vectorWindow = 50;

  constructor(private readonly embedding: EmbeddingService) {}

  async rank(query: string, packages: PackageForRetrieval[], limit = 10, options: { semantic?: boolean } = {}): Promise<ScoredPackage[]> {
    const intent = parseSearchIntent(query);
    if ((!intent.text && !intent.hasConstraints) || !packages.length) return [];
    const candidates = packages.filter(pkg => matchesSearchConstraints(intent, pkg)
      && matchesSearchExclusions(intent, [pkg.name, pkg.code, pkg.specialtyName, pkg.description, ...(pkg.symptoms || [])]));
    if (!candidates.length) return [];
    const keyword = candidates.map(pkg => ({ package: pkg, score: intent.text
      ? searchTextScore(intent.text, pkg.name) * 1.3 + searchTextScore(intent.text, pkg.code) * 1.4
        + searchTextScore(intent.text, pkg.specialtyName) * 1.1
        + Math.max(0, ...(pkg.symptoms || []).map(s => searchTextScore(intent.text, s))) * 1.2
        + searchTextScore(intent.text, pkg.description) * 0.3 : 1 }));
    if (intent.text && !keyword.some(item => item.score > 0)) {
      for (const item of keyword) item.score = Math.max(searchTypoScore(intent.text, item.package.name), searchTypoScore(intent.text, item.package.specialtyName));
    }
    const tieBreak = (a: PackageForRetrieval, b: PackageForRetrieval) =>
      (intent.followUp === undefined ? Number(Boolean(a.isFollowUp)) - Number(Boolean(b.isFollowUp)) : 0)
      || a.price - b.price || a.id.localeCompare(b.id);
    const lexical = keyword.filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || tieBreak(a.package, b.package));
    let semantic: ScoredPackage[] = [];
    if (intent.text && options.semantic !== false) {
      let hits: ScoredPackage[] | null = null;
      try {
        const vector = await this.embedding.embedSearchQuery(query);
        if (vector) hits = await this.embedding.retrieveVectorCandidates(vector, candidates, Math.min(this.vectorWindow, candidates.length));
      } catch { /* Keep usable lexical results during a vector outage. */ }
      if (hits === null && !lexical.length) throw new ServiceUnavailableException('Không thể tải kết quả tìm kiếm. Vui lòng thử lại.');
      if (hits === null) this.logger.debug('Vector search unavailable; returning keyword matches.');
      const eligible = new Map(candidates.map(pkg => [pkg.id, pkg]));
      semantic = (hits || []).filter(hit => eligible.has(hit.package.id) && Number.isFinite(hit.score) && hit.score >= this.minSimilarity)
        .map(hit => ({ ...hit, package: eligible.get(hit.package.id)! }))
        .sort((a, b) => b.score - a.score || tieBreak(a.package, b.package));
    }
    // Raw cosine and keyword scores are never added together.
    const scores = reciprocalRankFusion([lexical.map(item => item.package.id), semantic.map(item => item.package.id)]);
    const exact = (pkg: PackageForRetrieval) => Boolean(intent.text) &&
      [pkg.code, pkg.name].some(value => [query, intent.text].some(text => normalizeSearch(value) === normalizeSearch(text)));
    return candidates.filter(pkg => scores.has(pkg.id)).map(pkg => ({ package: pkg, score: scores.get(pkg.id)! }))
      .sort((a, b) => Number(exact(b.package)) - Number(exact(a.package))
        || b.score - a.score || tieBreak(a.package, b.package)).slice(0, limit);
  }
}
