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
   * Tìm kiếm kết hợp (Hybrid Search):
   * 1. Khớp từ khóa / triệu chứng thực tế từ Database: Tên gói (Name), Tag triệu chứng (Symptoms), Chuyên khoa (Specialty), Mô tả (Description)
   * 2. Với từ khóa ngắn (<= 4 từ): Chỉ trả về kết quả khi có Text/Symptom Match thực tế từ DB (Không dùng vector noise)
   * 3. Với câu văn dài (> 4 từ): Kết hợp Vector Embedding với ngưỡng tương đồng cao (>= 88%)
   */
  async searchByNaturalLanguage(
    queryText: string,
    packages: PackageForRetrieval[],
    topK = 10,
  ): Promise<ScoredPackage[]> {
    if (!queryText || !queryText.trim() || packages.length === 0) return [];
    const q = queryText.trim();
    const qNorm = this.normalizeVietnamese(q);
    const tokens = qNorm.split(/\s+/).filter((t) => t.length >= 2);
    const isShortQuery = tokens.length <= 4;

    // 1. Tính điểm Text / Keyword / Tag matching dựa trên 100% dữ liệu Database
    const textScoreMap = new Map<string, number>();

    for (const pkg of packages) {
      const nameRaw = pkg.name || '';
      const nameNorm = this.normalizeVietnamese(nameRaw);
      const specRaw = pkg.specialtyName || '';
      const specNorm = this.normalizeVietnamese(specRaw);
      const symptomsList = (pkg.symptoms || [])
        .map((s) => ({
          raw: (s || '').trim(),
          norm: this.normalizeVietnamese(s || ''),
        }))
        .filter((s) => s.norm.length >= 2);
      const descRaw = pkg.description || '';
      const descNorm = this.normalizeVietnamese(descRaw);

      let maxScore = 0;

      // 1.1. Khớp Tên gói khám (Trọng số cao nhất)
      const nameScore = this.matchTextScore(q, qNorm, nameRaw, nameNorm);
      if (nameScore > 0) {
        maxScore = Math.max(maxScore, nameScore * 1.3);
      }

      // 1.2. Khớp Tag / Triệu chứng lâm sàng thực tế từ Database
      for (const sym of symptomsList) {
        const symScore = this.matchTextScore(q, qNorm, sym.raw, sym.norm);
        if (symScore > 0) {
          maxScore = Math.max(maxScore, symScore * 1.2);
        }
      }

      // 1.3. Khớp Chuyên khoa
      const specScore = this.matchTextScore(q, qNorm, specRaw, specNorm);
      if (specScore > 0) {
        maxScore = Math.max(maxScore, specScore * 1.0);
      }

      // 1.4. Khớp Mô tả chi tiết
      const descScore = this.matchTextScore(q, qNorm, descRaw, descNorm);
      if (descScore > 0) {
        maxScore = Math.max(maxScore, descScore * 0.7);
      }

      if (maxScore > 0) {
        textScoreMap.set(pkg.id, maxScore);
      }
    }

    // 2. Tìm kiếm Vector Ngữ nghĩa (RediSearch / Cosine Similarity)
    const vectorScoreMap = new Map<string, number>();
    try {
      const queryVector = await this.embedText(q);
      if (queryVector) {
        const redisSearchResults = await this.searchWithRedisSearch(queryVector, packages, packages.length);
        if (redisSearchResults && redisSearchResults.length > 0) {
          for (const item of redisSearchResults) {
            if (item.score >= 0.70) {
              vectorScoreMap.set(item.package.id, item.score);
            }
          }
        }
      }
    } catch {}

    // 3. Kết hợp điểm số & Lọc kết quả (Hybrid Scoring & Thresholding)
    const scoredList: ScoredPackage[] = [];

    for (const pkg of packages) {
      const textScore = textScoreMap.get(pkg.id) || 0;
      const vectorScore = vectorScoreMap.get(pkg.id) || 0;

      // Điều kiện hợp lệ: Phải có Text match thực tế (textScore > 0) HOẶC Vector ngữ nghĩa cao (>= 0.82)
      if (textScore <= 0 && vectorScore < 0.82) continue;

      const finalScore = Number((textScore * 1.5 + vectorScore * 1.2).toFixed(3));

      scoredList.push({
        package: pkg,
        score: finalScore,
      });
    }

    // Sắp xếp điểm từ cao xuống thấp
    scoredList.sort((a, b) => b.score - a.score);

    return scoredList.slice(0, topK);
  }

  /**
   * So khớp văn bản hỗ trợ cả tiếng Việt có dấu, không dấu và các gốc từ triệu chứng y khoa
   */
  private matchTextScore(
    queryRaw: string,
    queryNorm: string,
    targetRaw: string,
    targetNorm: string,
  ): number {
    if (!queryRaw || !targetRaw) return 0;

    const qRaw = queryRaw.toLowerCase().trim();
    const qNorm = queryNorm.toLowerCase().trim();
    const tRaw = targetRaw.toLowerCase().trim();
    const tNorm = targetNorm.toLowerCase().trim();

    if (!qNorm || !tNorm) return 0;

    // 1. Khớp chính xác 100%
    if (tRaw === qRaw || tNorm === qNorm) {
      return 5.0;
    }

    // 2. Chứa nguyên cụm từ tìm kiếm
    if (tRaw.includes(qRaw)) {
      return 4.0; // Có dấu khớp nguyên cụm
    }
    if (tNorm.includes(qNorm)) {
      return 3.5; // Không dấu khớp nguyên cụm
    }

    // 3. Nếu query dài chứa trọn vẹn target (target là cụm từ y khoa >= 4 ký tự)
    if (tRaw.length >= 4 && qRaw.includes(tRaw)) {
      return 3.5;
    }
    if (tNorm.length >= 4 && qNorm.includes(tNorm)) {
      return 3.0;
    }

    // 4. Độ tương đồng Token Overlap (Dynamic Jaccard Token Matching)
    const hasDiacritics = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(qRaw);
    const qTokens = (hasDiacritics ? qRaw : qNorm).split(/[\s,.-]+/).filter((t) => t.length >= 2);
    const tTokens = (hasDiacritics ? tRaw : tNorm).split(/[\s,.-]+/).filter((t) => t.length >= 2);

    if (qTokens.length === 0 || tTokens.length === 0) return 0;

    const targetTokensCopy = [...tTokens];
    let matchedCount = 0;

    for (const qTok of qTokens) {
      const foundIdx = targetTokensCopy.findIndex((tTok) => tTok.startsWith(qTok) || tTok === qTok);
      if (foundIdx !== -1) {
        matchedCount++;
        targetTokensCopy.splice(foundIdx, 1);
      }
    }

    const ratio = matchedCount / qTokens.length;

    // Tỷ lệ khớp từ: Nếu khớp từ 50% số từ trở lên (ví dụ: gõ 2 từ khớp 1 từ, 3 từ khớp 2 từ)
    if (ratio >= 0.5) {
      return Number((ratio * 3.0).toFixed(2));
    }

    // Trường hợp tìm kiếm 1 từ đơn (ví dụ: gõ "ho", "xoang", "sốt", "mắt", "răng")
    if (qTokens.length === 1 && matchedCount === 1) {
      return 2.5;
    }

    return 0;
  }

  private fallbackKeywordMatcher(
    query: string,
    candidates: PackageForRetrieval[],
    topK: number,
  ): ScoredPackage[] {
    const qNorm = this.normalizeVietnamese(query);
    const scored = candidates.map((pkg) => {
      const nameNorm = this.normalizeVietnamese(pkg.name || '');
      const descNorm = this.normalizeVietnamese(pkg.description || '');
      const specNorm = this.normalizeVietnamese(pkg.specialtyName || '');
      const symNorm = (pkg.symptoms || []).map((s) => this.normalizeVietnamese(s)).join(' ');
      const targetText = `${nameNorm} ${specNorm} ${descNorm} ${symNorm}`;

      const score = this.matchTextScore(query, qNorm, `${pkg.name} ${pkg.specialtyName}`, targetText);
      return { package: pkg, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  private normalizeVietnamese(str: string): string {
    if (!str) return '';
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase()
      .trim();
  }
}
