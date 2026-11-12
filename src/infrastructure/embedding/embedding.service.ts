import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { createHash } from 'node:crypto';
import { RedisService } from '../redis/redis.service.js';
import { matchesSearchConstraints, matchesSearchExclusions, normalizeSearch, parseSearchIntent, searchTextScore, searchTypoScore } from '../../common/utils/search-query.js';

export interface PackageForRetrieval {
  id: string;
  code: string;
  name: string;
  description: string;
  symptoms?: string[];
  price: number;
  durationMin: number;
  specialtyId: number | null;
  specialtyName: string;
  targetGender?: string; // ALL, MALE, FEMALE
  minAge?: number | null;
  maxAge?: number | null;
  branchId?: string;
  bookingMethodCode?: string;
  isFollowUp?: boolean;
}

export interface ScoredPackage {
  package: PackageForRetrieval;
  score: number;
  matchedKeywords?: string[];
}

type PackageEmbeddingSource = Omit<PackageForRetrieval, 'price' | 'description' | 'specialtyName'> & {
  price: unknown;
  description?: string | null;
  specialty?: { name: string; description?: string | null; symptoms?: string[] } | null;
};

/** Shared by catalog sync, background jobs and recommendation retrieval. */
export function mapPackageForRetrieval(pkg: PackageEmbeddingSource): PackageForRetrieval {
  return {
    id: pkg.id, code: pkg.code, name: pkg.name, price: Number(pkg.price), durationMin: pkg.durationMin,
    specialtyId: pkg.specialtyId, specialtyName: pkg.specialty?.name || 'Đa khoa',
    description: [pkg.description, pkg.specialty?.description].filter(Boolean).join(' - '),
    symptoms: [...new Set([...(pkg.symptoms || []), ...(pkg.specialty?.symptoms || [])])],
    targetGender: pkg.targetGender, minAge: pkg.minAge, maxAge: pkg.maxAge,
    isFollowUp: pkg.isFollowUp === true || /(?:^|-)FOLLOWUP$/i.test(pkg.code) || /\btai kham\b/.test(normalizeSearch(pkg.name)),
  };
}

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private aiClient: OpenAI | null = null;
  private readonly embeddingModel: string;
  private readonly queryVectors = new Map<string, { expiresAt: number; vector: number[] }>();
  private readonly pendingQueryVectors = new Map<string, Promise<number[] | null>>();

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {
    this.embeddingModel =
      this.config.get<string>('openai.embeddingModel') ||
      process.env.OPENAI_EMBEDDING_MODEL ||
      'text-embedding-3-small';

    const apiKey = this.config.get<string>('openai.apiKey') || process.env.OPENAI_API_KEY;
    if (apiKey) {
      try {
        this.aiClient = new OpenAI({ apiKey, timeout: 10000, maxRetries: 0 });
      } catch (err: any) {
        this.logger.warn('Failed to initialize OpenAI embedding client');
      }
    }
  }

  readonly vectorDimensions = 1536;

  get vectorKeyPrefix(): string { return `pkg_vss:openai:v2:${this.embeddingModel}:${this.vectorDimensions}:`; }
  get vectorIndexName(): string { return `idx:packages_vss:openai:v2:${this.embeddingModel}:${this.vectorDimensions}`; }

  async ensureVectorIndex(): Promise<void> {
    const client = this.redis.getClient();
    if (!client) throw new Error('Redis must be enabled to synchronize package vectors');
    try { await client.call('FT.INFO', this.vectorIndexName); return; }
    catch (error: any) {
      if (!/unknown index|no such index/i.test(error?.message || '')) throw error;
    }
    const prefix = `${client.options.keyPrefix || ''}${this.vectorKeyPrefix}`;
    
    try {
      await client.call(
        'FT.CREATE', this.vectorIndexName, 
        'ON', 'HASH', 'PREFIX', 1, prefix,
        'SCHEMA', 
        'packageId', 'TAG', 
        'vector', 'VECTOR', 'HNSW', 6, 
        'TYPE', 'FLOAT32',
        'DIM', this.vectorDimensions, 
        'DISTANCE_METRIC', 'COSINE');
    } catch (error: any) {
      if (!/index already exists/i.test(error?.message || '')) throw error;
    }
  }

  /**
   * Tạo vector embedding từ một đoạn văn bản sử dụng OpenAI Embedding
   */
  async embedText(text: string): Promise<number[] | null> {
    if (!this.aiClient || !text.trim()) return null;

    try {
      const response = await this.aiClient.embeddings.create({
        model: this.embeddingModel, input: text.trim().slice(0, 2048),
        dimensions: this.vectorDimensions, encoding_format: 'float',
      });
      const values = response.data[0]?.embedding;
      if (values?.length === this.vectorDimensions && values.every(Number.isFinite)) return values;
    } catch (err: any) {
      this.logger.warn(`OpenAI embedding failed: status=${err?.status || 'unknown'}`);
    }
    return null;
  }

  /**
   * emveeding cho goi kham benh
   */
  buildPackageEmbeddingText(pkg: { name: string; specialtyName?: string; description?: string; symptoms?: string[] }): string {
    const specialty = pkg.specialtyName ? `Chuyên khoa: ${pkg.specialtyName}. ` : '';
    const desc = pkg.description ? `Mô tả: ${pkg.description.slice(0, 500)}. ` : '';
    const symptomsStr = Array.isArray(pkg.symptoms) && pkg.symptoms.length > 0
      ? `Triệu chứng lâm sàng: ${pkg.symptoms.join(', ')}`
      : '';
    return `Gói khám: ${pkg.name}. ${specialty}${desc}${symptomsStr}`.trim();
  }

  /**
   * embeeding cho profile patient
   */
  buildPatientEmbeddingText(profile: {
    fullName?: string;
    age: number | null;
    gender: string;
    bmi: number | null;
    medicalHistory?: string;
    allergies?: string;
    familyHistory?: string | null;
  }): string {
    const genderVi = profile.gender === 'MALE' ? 'Nam' : profile.gender === 'FEMALE' ? 'Nữ' : 'Khác';
    const bmiText = profile.bmi ? `Chỉ số thể trạng BMI: ${profile.bmi}.` : '';
    const med = profile.medicalHistory?.trim()
      ? `Tiền sử bệnh mạn tính: ${profile.medicalHistory}.`
      : 'Chưa ghi nhận tiền sử bệnh nền.';
    const allergy = profile.allergies?.trim() ? `Tiền sử dị ứng: ${profile.allergies}.` : '';

    const ageText = profile.age === null ? 'chưa ghi nhận độ tuổi' : `${profile.age} tuổi`;
    const family = profile.familyHistory ? `Tiền sử gia đình: ${profile.familyHistory}.` : '';
    return `Bệnh nhân ${genderVi}, ${ageText}. ${bmiText} ${med} ${allergy} ${family}`.trim();
  }

  /**
   * Lấy hoặc tạo mới vector embedding cho một gói khám trong RediSearch Hash (Key: pkg_vss:<id>)
   */
  async getOrComputePackageVector(pkg: PackageForRetrieval): Promise<number[] | null> {
    const hashKey = `${this.vectorKeyPrefix}${pkg.id}`;
    const text = this.buildPackageEmbeddingText(pkg);
    const fingerprint = createHash('sha256').update(text).digest('hex');

    // 1. Kiểm tra Redis Hash xem đã có vector nhị phân chưa
    if (this.redis.isEnabled()) {
      try {
        const client = this.redis.getClient();
        if (client) {
          const vectorBuf = await client.hgetBuffer(hashKey, 'vector');
          if (vectorBuf?.length === this.vectorDimensions * 4 && await client.hget(hashKey, 'fingerprint') === fingerprint) {
            const float32 = new Float32Array(
              Uint8Array.from(vectorBuf).buffer,
              0,
              vectorBuf.byteLength / 4,
            );
            return Array.from(float32);
          }
        }
      } catch (err: any) {
        this.logger.warn(`Redis hgetBuffer failed for package vector ${pkg.id}: ${err?.message}`);
      }
    }

    // 2. Cache miss: Gọi OpenAI text-embedding
    this.logger.log(`[Embedding] Generating vector for package "${pkg.name}" (${pkg.code}) via OpenAI...`);
    const vector = await this.embedText(text);
    if (vector && this.redis.isEnabled()) {
      try {
        const float32 = new Float32Array(vector);
        const vectorBuffer = Buffer.from(float32.buffer);
        const client = this.redis.getClient();
        if (client) {
          await client.hset(
            hashKey,
            'packageId', pkg.id,
            'fingerprint', fingerprint,
            'code', pkg.code,
            'name', pkg.name,
            'specialtyName', pkg.specialtyName || 'Đa khoa',
            'price', String(pkg.price),
            'vector', vectorBuffer,
          );
          // Dọn dẹp legacy key nếu có
          await client.del(`vector:pkg:${pkg.id}`).catch(() => { });
          this.logger.log(`[Embedding] Saved package vector directly into RedisSearch Hash ${hashKey}`);
        }
      } catch (err: any) {
        this.logger.warn(`Failed to save package vector hash for ${pkg.id}: ${err?.message}`);
      }
    }
    return vector;
  }

  /**
   * Xóa vector của gói khám trên Redis khi gói khám được cập nhật nội dung
   */
  async invalidatePackageVector(packageId: string): Promise<void> {
    if (this.redis.isEnabled()) {
      try {
        await this.redis.delete(`${this.vectorKeyPrefix}${packageId}`, `vector:pkg:${packageId}`);
        this.logger.log(`[Embedding] Invalidated Redis vector hash for package ${packageId}`);
      } catch (err: any) {
        this.logger.warn(`Failed to delete Redis vector hash for package ${packageId}: ${err?.message}`);
      }
    }
  }

  /**
  laya top k goii kham bang HNSW index cua redis search
   */
  async retrieveTopPackages(
    patientEmbeddingText: string,
    candidates: PackageForRetrieval[],
    topK = 20,
  ): Promise<ScoredPackage[]> {
    if (candidates.length <= topK) {
      this.logger.log(`[VectorRetrieval] Candidates (${candidates.length}) <= topK (${topK}). Keeping all candidate packages.`);
      return candidates.map((p) => ({ package: p, score: 1.0 }));
    }

    // 1. Tạo vector cho bệnh nhân
    const patientVector = await this.embedText(patientEmbeddingText);

    // 2. Truy vấn trực tiếp qua RediSearch HNSW (< 1ms)
    if (patientVector) {
      const redisSearchResults = await this.retrieveVectorCandidates(patientVector, candidates, topK);
      if (redisSearchResults && redisSearchResults.length > 0) {
        return redisSearchResults;
      }
    }

    // 3. Fallback Heuristic Matcher khi RediSearch chưa sẵn sàng hoặc không có mạng / API key
    this.logger.warn(`[VectorRetrieval] RediSearch did not return results. Using keyword matcher for ${candidates.length} candidates.`);
    return this.fallbackKeywordMatcher(patientEmbeddingText, candidates, topK);
  }

  // danh sách sau khi so sánh vector
  async retrieveVectorCandidates(
    queryVector: number[],
    candidates: PackageForRetrieval[],
    topK: number,
  ): Promise<ScoredPackage[] | null> {
    if (!this.redis.isEnabled()) return null;

    try {
      const float32 = new Float32Array(queryVector);
      const vectorBuffer = Buffer.from(float32.buffer);

      if (candidates.length === 0) return [];
      const fetchK = Math.min(topK, candidates.length);
      const ids = candidates.map(({ id }) => id.replace(/[^a-zA-Z0-9]/g, '\\$&')).join('|');
      const query = `(@packageId:{${ids}})=>[KNN ${fetchK} @vector $BLOB AS score]`;

      const tStart = performance.now();
      const rawResult = await this.redis.call(
        'FT.SEARCH',
        this.vectorIndexName,
        query,
        'PARAMS',
        '2',
        'BLOB',
        vectorBuffer,
        'SORTBY',
        'score',
        'ASC',
        'RETURN',
        '2',
        'packageId',
        'score',
        'LIMIT',
        '0',
        fetchK,
        'DIALECT',
        '2',
      );
      const duration = (performance.now() - tStart).toFixed(2);

      if (!Array.isArray(rawResult)) return null;

      // Redis fields arrive as [name, value, name, value, ...].
      const toFields = (values: unknown[]): Record<string, unknown> => Object.fromEntries(
        Array.from({ length: Math.floor(values.length / 2) }, (_, i) => [String(values[i * 2]), values[i * 2 + 1]]),
      );
      const responseFields = toFields(rawResult);
      const attributes = Array.isArray(responseFields.results)
        ? responseFields.results.map(item => Array.isArray(item) ? toFields(item).extra_attributes : null)
        : rawResult.filter((_, index) => index >= 2 && index % 2 === 0);

      if (!attributes.length) return rawResult[0] === 0 || responseFields.total_results === 0 ? [] : null;

      const candidateMap = new Map(candidates.map(pkg => [pkg.id, pkg]));
      const scoredList: ScoredPackage[] = attributes.flatMap(attrs => {
        if (!Array.isArray(attrs)) return [];
        const { packageId, score } = toFields(attrs);
        const pkg = candidateMap.get(String(packageId ?? ''));
        if (!pkg) return [];
        const parsed = Number(score);
        const distance = Number.isFinite(parsed) ? parsed : 1;
        return [{ package: pkg, score: Math.max(0, 1 - distance) }];
      });

      if (scoredList.length > 0) {
        this.logger.log(
          `[VectorRetrieval: RedisSearch HNSW] ⚡ Completed in ${duration}ms. Matched ${scoredList.length} candidate packages from Redis RAM. Top score: ${scoredList[0]?.score?.toFixed(3)} ("${scoredList[0]?.package?.name}")`,
        );
        return scoredList.slice(0, topK);
      }

      return null;
    } catch (err: any) {
      this.logger.warn(`RedisSearch query failed, falling back to keyword matcher: ${err?.message}`);
      return null;
    }
  }

  /** Shared query cache and in-flight deduplication for search and recommendations. */
  async embedSearchQuery(text: string): Promise<number[] | null> {
    const key = text.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!key) return null;
    const cached = this.queryVectors.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.vector;
    if (cached) this.queryVectors.delete(key);
    const pending = this.pendingQueryVectors.get(key);
    if (pending) return pending;
    if (!this.aiClient) return null;
    const request = (async () => {
      try {
        const vector = await this.embedText(key);
        if (!vector?.length) return null;
        if (this.queryVectors.size >= 200) this.queryVectors.delete(this.queryVectors.keys().next().value!);
        this.queryVectors.set(key, { vector, expiresAt: Date.now() + 300_000 });
        return vector;
      } catch {
        this.logger.debug('Search embedding unavailable; using text matches.');
        return null;
      }
    })();
    this.pendingQueryVectors.set(key, request);
    try { return await request; }
    finally { this.pendingQueryVectors.delete(key); }
  }

  /** Combine field matches and semantic hits after applying explicit constraints. */
  async searchByNaturalLanguage(queryText: string, packages: PackageForRetrieval[], topK = 10, options: { strictSemantic?: boolean } = {}): Promise<ScoredPackage[]> {
    const intent = parseSearchIntent(queryText);
    if ((!intent.text && !intent.hasConstraints) || packages.length === 0) return [];
    const candidates = packages.filter(pkg => matchesSearchConstraints(intent, pkg)
      && matchesSearchExclusions(intent, [pkg.name, pkg.specialtyName, pkg.description, ...(pkg.symptoms || [])]));
    if (candidates.length === 0) return [];
    const textScores = new Map<string, number>();
    for (const pkg of candidates) {
      const score = intent.text
        ? searchTextScore(intent.text, pkg.name) * 1.3
          + searchTextScore(intent.text, pkg.code) * 1.4
          + searchTextScore(intent.text, pkg.specialtyName) * 1.1
          + Math.max(0, ...(pkg.symptoms || []).map(symptom => searchTextScore(intent.text, symptom))) * 1.2
          + searchTextScore(intent.text, pkg.description) * 0.3
        : 1;
      if (score > 0) textScores.set(pkg.id, score);
    }
    // Do not dilute exact matches or loosen clinical exclusions/price constraints.
    // Only rescue an otherwise empty text result with a bounded title/specialty typo.
    if (intent.text && textScores.size === 0) {
      for (const pkg of candidates) {
        const score = Math.max(searchTypoScore(intent.text, pkg.name), searchTypoScore(intent.text, pkg.specialtyName));
        if (score > 0) textScores.set(pkg.id, score);
      }
    }
    const vectorScores = new Map<string, number>();
    const minSemanticScore = 0.82;
    // Preserve accents for embeddings. Exclusions are already enforced on candidates.
    if (intent.text) {
      const vector = await this.embedSearchQuery(queryText);
      if (vector) {
        const hits = await this.retrieveVectorCandidates(vector, candidates, Math.min(20, candidates.length));
        if (hits === null && options.strictSemantic && textScores.size === 0) throw new Error('Semantic index unavailable');
        for (const hit of hits || []) if (hit.score >= minSemanticScore) vectorScores.set(hit.package.id, hit.score);
      } else if (options.strictSemantic && textScores.size === 0) throw new Error('Search embedding unavailable');
    }
    return candidates.flatMap(pkg => {
      const textScore = textScores.get(pkg.id) || 0;
      const vectorScore = vectorScores.get(pkg.id) || 0;
      if (textScore === 0 && vectorScore < minSemanticScore) return [];
      return [{ package: pkg, score: Number((textScore * 1.5 + vectorScore * 1.2).toFixed(3)) }];
    }).sort((a, b) => (intent.followUp === undefined ? Number(Boolean(a.package.isFollowUp)) - Number(Boolean(b.package.isFollowUp)) : 0)
      || b.score - a.score
      || a.package.price - b.package.price || a.package.id.localeCompare(b.package.id)).slice(0, topK);
  }

  private fallbackKeywordMatcher(
    query: string,
    candidates: PackageForRetrieval[],
    topK: number,
  ): ScoredPackage[] {
    const text = normalizeSearch(parseSearchIntent(query).text);
    const tokens = [...new Set(text.split(' ').filter(Boolean))];
    return candidates.map(pkg => {
      const target = normalizeSearch([pkg.name, pkg.specialtyName, pkg.description, ...(pkg.symptoms || [])].join(' '));
      const words = new Set(target.split(' '));
      // Profile histories may match part of the text; search uses stricter matching.
      const score = searchTextScore(text, target) ||
        tokens.filter(token => words.has(token)).length / Math.max(tokens.length, 1);
      return { package: pkg, score };
    }).sort((a, b) => b.score - a.score).slice(0, topK);
  }
}
