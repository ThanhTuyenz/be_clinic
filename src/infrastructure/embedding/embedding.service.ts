import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { RedisService } from '../redis/redis.service.js';

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
  minAge?: number;
  maxAge?: number;
}

export interface ScoredPackage {
  package: PackageForRetrieval;
  score: number;
  matchedKeywords?: string[];
}

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private aiClient: GoogleGenAI | null = null;
  private readonly embeddingModel: string;
  private readonly VECTOR_TTL_SECONDS = 30 * 24 * 3600; // 30 ngày

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {
    this.embeddingModel =
      this.config.get<string>('gemini.embeddingModel') ||
      process.env.GEMINI_EMBEDDING_MODEL ||
      'gemini-embedding-001';

    const apiKey = this.config.get<string>('gemini.apiKey') || process.env.GEMINI_API_KEY;
    if (apiKey) {
      try {
        this.aiClient = new GoogleGenAI({ apiKey });
      } catch (err: any) {
        this.logger.warn(`Failed to initialize GoogleGenAI in EmbeddingService: ${err?.message}`);
      }
    }
  }

  /**
   * Tạo vector embedding từ một đoạn văn bản sử dụng Google Gemini Embedding
   */
  async embedText(text: string): Promise<number[] | null> {
    if (!this.aiClient || !text.trim()) return null;

    try {
      const response = await this.aiClient.models.embedContent({
        model: this.embeddingModel,
        contents: text.trim().slice(0, 2048),
      });

      const values =
        (response as any)?.embedding?.values ||
        (response as any)?.embeddings?.[0]?.values;
      if (Array.isArray(values) && values.length > 0) {
        return values;
      }
    } catch (err: any) {
      this.logger.warn(`Embedding generation failed with model ${this.embeddingModel} for text "${text.slice(0, 50)}...": ${err?.message}`);
    }
    return null;
  }

  /**
   * Tính Cosine Similarity giữa 2 vector nhiều chiều
   */
  cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length || vecA.length === 0) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
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
    age: number;
    gender: string;
    bmi: number | null;
    medicalHistory?: string;
    allergies?: string;
  }): string {
    const genderVi = profile.gender === 'MALE' ? 'Nam' : profile.gender === 'FEMALE' ? 'Nữ' : 'Khác';
    const bmiText = profile.bmi ? `Chỉ số thể trạng BMI: ${profile.bmi}.` : '';
    const med = profile.medicalHistory?.trim()
      ? `Tiền sử bệnh mạn tính: ${profile.medicalHistory}.`
      : 'Không có tiền sử bệnh nền.';
    const allergy = profile.allergies?.trim() ? `Tiền sử dị ứng: ${profile.allergies}.` : '';

    return `Bệnh nhân ${genderVi}, ${profile.age} tuổi. ${bmiText} ${med} ${allergy}`.trim();
  }

  /**
   * Lấy hoặc tạo mới vector embedding cho một gói khám trong RediSearch Hash (Key: pkg_vss:<id>)
   */
  async getOrComputePackageVector(pkg: PackageForRetrieval): Promise<number[] | null> {
    const hashKey = `pkg_vss:${pkg.id}`;

    // 1. Kiểm tra Redis Hash xem đã có vector nhị phân chưa
    if (this.redis.isEnabled()) {
      try {
        const client = this.redis.getClient();
        if (client) {
          const vectorBuf = await client.hgetBuffer(hashKey, 'vector');
          if (vectorBuf && vectorBuf.length > 0) {
            const float32 = new Float32Array(
              vectorBuf.buffer,
              vectorBuf.byteOffset,
              vectorBuf.byteLength / 4,
            );
            return Array.from(float32);
          }
        }
      } catch (err: any) {
        this.logger.warn(`Redis hgetBuffer failed for package vector ${pkg.id}: ${err?.message}`);
      }
    }

    // 2. Cache miss: Gọi Google text-embedding
    this.logger.log(`[Embedding] Generating vector for package "${pkg.name}" (${pkg.code}) via Gemini...`);
    const text = this.buildPackageEmbeddingText(pkg);
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
        await this.redis.delete(`pkg_vss:${packageId}`, `vector:pkg:${packageId}`);
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
      const redisSearchResults = await this.searchWithRedisSearch(patientVector, candidates, topK);
      if (redisSearchResults && redisSearchResults.length > 0) {
        return redisSearchResults;
      }
    }

    // 3. Fallback Heuristic Matcher khi RediSearch chưa sẵn sàng hoặc không có mạng / API key
    this.logger.warn(`[VectorRetrieval] RediSearch did not return results. Using keyword matcher for ${candidates.length} candidates.`);
    return this.fallbackKeywordMatcher(patientEmbeddingText, candidates, topK);
  }

  /**
   *  redis serch hnsw
   */
  private async searchWithRedisSearch(
    queryVector: number[],
    candidates: PackageForRetrieval[],
    topK: number,
  ): Promise<ScoredPackage[] | null> {
    if (!this.redis.isEnabled()) return null;

    try {
      const float32 = new Float32Array(queryVector);
      const vectorBuffer = Buffer.from(float32.buffer);

      const fetchK = Math.min(Math.max(topK * 2, 25), 150);
      const query = `*=>[KNN ${fetchK} @vector $BLOB AS score]`;

      const tStart = performance.now();
      const rawResult = await this.redis.call(
        'FT.SEARCH',
        'idx:packages_vss',
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
        'DIALECT',
        '2',
      );
      const duration = (performance.now() - tStart).toFixed(2);

      if (!Array.isArray(rawResult)) return null;

      let resultsList: any[] = [];
      for (let i = 0; i < rawResult.length; i += 2) {
        if (rawResult[i] === 'results' && Array.isArray(rawResult[i + 1])) {
          resultsList = rawResult[i + 1];
          break;
        }
      }

      if (resultsList.length === 0) {
        for (let i = 1; i < rawResult.length; i += 2) {
          if (Array.isArray(rawResult[i + 1])) {
            resultsList.push(['id', rawResult[i], 'extra_attributes', rawResult[i + 1]]);
          }
        }
      }

      if (resultsList.length === 0) return null;

      const candidateMap = new Map<string, PackageForRetrieval>();
      for (const c of candidates) {
        candidateMap.set(c.id, c);
      }

      const scoredList: ScoredPackage[] = [];

      for (const item of resultsList) {
        if (!Array.isArray(item)) continue;
        let packageId = '';
        let dist = 1.0;

        for (let j = 0; j < item.length; j += 2) {
          if (item[j] === 'extra_attributes' && Array.isArray(item[j + 1])) {
            const attrs = item[j + 1];
            for (let k = 0; k < attrs.length; k += 2) {
              if (attrs[k] === 'packageId') packageId = String(attrs[k + 1]);
              if (attrs[k] === 'score') dist = parseFloat(attrs[k + 1]) || 1.0;
            }
          }
        }

        if (packageId && candidateMap.has(packageId)) {
          const pkg = candidateMap.get(packageId)!;
          const similarityScore = Math.max(0, 1 - dist);
          scoredList.push({
            package: pkg,
            score: similarityScore,
          });
        }
      }

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

  /**
     search native langugee
   */
  async searchByNaturalLanguage(
    queryText: string,
    packages: PackageForRetrieval[],
    topK = 10,
  ): Promise<ScoredPackage[]> {
    const queryVector = await this.embedText(queryText);

    if (queryVector) {
      const redisSearchResults = await this.searchWithRedisSearch(queryVector, packages, topK);
      if (redisSearchResults && redisSearchResults.length > 0) {
        return redisSearchResults;
      }
    }

    // Fallback keyword search
    return this.fallbackKeywordMatcher(queryText, packages, topK);
  }

  /**
   * Fallback tìm kiếm theo từ khóa / token y khoa nội bộ
   */
  private fallbackKeywordMatcher(
    query: string,
    candidates: PackageForRetrieval[],
    topK: number,
  ): ScoredPackage[] {
    const tokens = query
      .toLowerCase()
      .split(/[\s,.-]+/)
      .filter((t) => t.length >= 2);

    const scored = candidates.map((pkg) => {
      const symptomsStr = (pkg.symptoms || []).join(' ');
      const targetText = `${pkg.name} ${pkg.specialtyName} ${pkg.description} ${symptomsStr}`.toLowerCase();
      let matchCount = 0;
      for (const t of tokens) {
        if (targetText.includes(t)) matchCount++;
      }
      return {
        package: pkg,
        score: matchCount / Math.max(1, tokens.length),
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }
}
