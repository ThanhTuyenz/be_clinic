import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { RedisService } from '../../infrastructure/cache/redis/redis.service.js';

export interface PackageForRetrieval {
  id: string;
  code: string;
  name: string;
  description: string;
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

    const candidateModels = [
      this.embeddingModel,
      'gemini-embedding-001',
      'embedding-001',
    ];

    for (const model of [...new Set(candidateModels)]) {
      try {
        const response = await this.aiClient.models.embedContent({
          model,
          contents: text.trim().slice(0, 2048),
        });

        const values =
          (response as any)?.embedding?.values ||
          (response as any)?.embeddings?.[0]?.values;
        if (Array.isArray(values) && values.length > 0) {
          return values;
        }
      } catch (err: any) {
        if (err?.message?.includes('404') || err?.message?.includes('not found')) {
          continue;
        }
        this.logger.warn(`Embedding generation failed with model ${model} for text "${text.slice(0, 50)}...": ${err?.message}`);
      }
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
   * Tạo văn bản đại diện ngữ nghĩa y khoa của một gói khám
   */
  buildPackageEmbeddingText(pkg: { name: string; specialtyName?: string; description?: string }): string {
    const specialty = pkg.specialtyName ? `Chuyên khoa: ${pkg.specialtyName}. ` : '';
    const desc = pkg.description ? `Mô tả & Chỉ định: ${pkg.description.slice(0, 300)}` : '';
    return `Gói khám: ${pkg.name}. ${specialty}${desc}`.trim();
  }

  /**
   * Tạo văn bản đại diện ngữ nghĩa lâm sàng của hồ sơ bệnh nhân
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
   * Lấy hoặc tạo mới vector embedding cho một gói khám (Sử dụng Redis Cache với TTL 30 ngày)
   */
  async getOrComputePackageVector(pkg: PackageForRetrieval): Promise<number[] | null> {
    const redisKey = `vector:pkg:${pkg.id}`;

    // 1. Kiểm tra Redis Cache
    if (this.redis.isEnabled()) {
      try {
        const cachedVector = await this.redis.get<number[]>(redisKey);
        if (Array.isArray(cachedVector) && cachedVector.length > 0) {
          return cachedVector;
        }
      } catch (err: any) {
        this.logger.warn(`Redis get failed for package vector ${pkg.id}: ${err?.message}`);
      }
    }

    // 2. Cache miss: Gọi Google text-embedding
    this.logger.log(`[Embedding] Cache miss for package "${pkg.name}" (${pkg.code}). Generating vector via Gemini...`);
    const text = this.buildPackageEmbeddingText(pkg);
    const vector = await this.embedText(text);
    if (vector && this.redis.isEnabled()) {
      try {
        await this.redis.set(redisKey, vector, this.VECTOR_TTL_SECONDS);
        this.logger.log(`[Embedding] Cached vector for package "${pkg.name}" (${pkg.id}) into Redis (TTL 30d)`);
      } catch (err: any) {
        this.logger.warn(`Failed to cache vector in Redis for package ${pkg.id}: ${err?.message}`);
      }
    }
    return vector;
  }

  /**
   * Xóa cache vector của gói khám trên Redis khi được cập nhật nội dung
   */
  async invalidatePackageVector(packageId: string): Promise<void> {
    if (this.redis.isEnabled()) {
      try {
        await this.redis.delete(`vector:pkg:${packageId}`);
        this.logger.log(`[Embedding] Invalidated Redis vector cache for package ${packageId}`);
      } catch (err: any) {
        this.logger.warn(`Failed to delete Redis vector cache for package ${packageId}: ${err?.message}`);
      }
    }
  }

  /**
   * Tầng 2: Vector Retrieval - Lấy Top K gói khám có độ tương đồng ngữ nghĩa cao nhất
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

    const t0 = Date.now();
    // 1. Tạo vector cho bệnh nhân
    const patientVector = await this.embedText(patientEmbeddingText);

    // 2. Nếu có patient vector: Tính Cosine Similarity
    if (patientVector) {
      const scoredList: ScoredPackage[] = [];
      let cacheHits = 0;
      let newlyGenerated = 0;

      for (const pkg of candidates) {
        const redisKey = `vector:pkg:${pkg.id}`;
        let pkgVector: number[] | null = null;
        if (this.redis.isEnabled()) {
          pkgVector = await this.redis.get<number[]>(redisKey).catch(() => null);
        }

        if (pkgVector && Array.isArray(pkgVector) && pkgVector.length > 0) {
          cacheHits++;
        } else {
          newlyGenerated++;
          pkgVector = await this.getOrComputePackageVector(pkg);
        }

        if (pkgVector) {
          const score = this.cosineSimilarity(patientVector, pkgVector);
          scoredList.push({ package: pkg, score });
        } else {
          scoredList.push({ package: pkg, score: 0.1 });
        }
      }

      // Sắp xếp giảm dần theo điểm tương đồng ngữ nghĩa
      scoredList.sort((a, b) => b.score - a.score);
      const topResults = scoredList.slice(0, topK);
      const duration = Date.now() - t0;

      this.logger.log(
        `[VectorRetrieval] Scored ${candidates.length} packages in ${duration}ms (Redis Hits: ${cacheHits}, Generated: ${newlyGenerated}). Top score: ${topResults[0]?.score?.toFixed(3) ?? 0} ("${topResults[0]?.package?.name}")`,
      );

      return topResults;
    }

    // 3. Fallback Heuristic Matcher khi không có mạng hoặc chưa có API key
    this.logger.warn(`[VectorRetrieval] Patient vector failed. Falling back to keyword matcher for ${candidates.length} candidates.`);
    return this.fallbackKeywordMatcher(patientEmbeddingText, candidates, topK);
  }

  /**
   * Tìm kiếm gói khám bằng Ngôn ngữ tự nhiên / Triệu chứng (Semantic Natural Language Search)
   */
  async searchByNaturalLanguage(
    queryText: string,
    packages: PackageForRetrieval[],
    topK = 10,
  ): Promise<ScoredPackage[]> {
    const queryVector = await this.embedText(queryText);

    if (queryVector) {
      const scoredList: ScoredPackage[] = [];
      for (const pkg of packages) {
        const pkgVector = await this.getOrComputePackageVector(pkg);
        if (pkgVector) {
          const score = this.cosineSimilarity(queryVector, pkgVector);
          scoredList.push({ package: pkg, score });
        }
      }
      scoredList.sort((a, b) => b.score - a.score);
      return scoredList.slice(0, topK);
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
      .filter((t) => t.length > 2);

    const scored = candidates.map((pkg) => {
      const targetText = `${pkg.name} ${pkg.specialtyName} ${pkg.description}`.toLowerCase();
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
