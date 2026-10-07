import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI, Type } from '@google/genai';
import { RecommendedPackageItemDto, RecommendationPriority } from '../recommendation.dto.js';
import { CandidatePoolItem } from '../constants/recommendation.constants.js';

@Injectable()
export class AiRankingService {
  private readonly logger = new Logger(AiRankingService.name);
  private aiClient: GoogleGenAI | null = null;
  private readonly modelName: string;
  private readonly AI_TIMEOUT_MS = 4000;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('gemini.apiKey') || process.env.GEMINI_API_KEY;
    this.modelName = this.config.get<string>('gemini.model') || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    if (apiKey) {
      try {
        this.aiClient = new GoogleGenAI({ apiKey });
      } catch (err: any) {
        this.logger.warn(`Failed to initialize GoogleGenAI: ${err?.message}`);
      }
    } else {
      this.logger.warn('GEMINI_API_KEY not found; will use Rule-based clinical fallback');
    }
  }

  isAiAvailable(): boolean {
    return !!this.aiClient;
  }

  // rerank
  async evaluateHybridWithGemini(context: {
    profile: {
      fullName: string;
      age: number;
      gender: string;
      bmi: number | null;
      medicalHistory: string;
      allergies: string;
    } | null;
    behaviorContext: {
      topSpecialties: string;
      lastSearchQuery: string;
      dropOffPkgName?: string;
    };
    candidates: Array<{
      id: string;
      name: string;
      code: string;
      slug?: string;
      description: string;
      price: number;
      specialtyName: string;
      specialtyId: number | null;
      durationMin: number;
      origin: string;
      behaviorSourceType?: string;
    }>;
  }): Promise<RecommendedPackageItemDto[]> {
    if (!this.aiClient || context.candidates.length === 0) return [];

    try {
      const prompt = this.buildHybridPrompt(context);

      // Gọi Gemini có Timeout bảo vệ (Không bao giờ để user chờ quá 4s)
      const generatePromise = this.aiClient.models.generateContent({
        model: this.modelName,
        contents: prompt,
        config: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              selectedPackages: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    packageId: { type: Type.STRING },
                    priority: { type: Type.STRING },
                    badge: { type: Type.STRING },
                    clinicalReason: { type: Type.STRING },
                    sourceType: { type: Type.STRING },
                  },
                  required: ['packageId', 'priority', 'badge', 'clinicalReason'],
                },
              },
            },
            required: ['selectedPackages'],
          },
        },
      });

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Gemini timeout after ${this.AI_TIMEOUT_MS}ms`)), this.AI_TIMEOUT_MS),
      );

      const response = await Promise.race([generatePromise, timeoutPromise]);
      const selections = this.safeParseSelections(response.text);

      // Tra cứu O(1) qua Map
      const candidateMap = new Map(context.candidates.map((c) => [c.id, c]));
      const addedIds = new Set<string>();
      const result: RecommendedPackageItemDto[] = [];

      for (const sel of selections) {
        const match = candidateMap.get(sel.packageId);
        if (!match || addedIds.has(match.id)) continue;

        addedIds.add(match.id);
        const finalSourceType = this.resolveSourceType(sel.sourceType, match);

        result.push({
          packageId: match.id,
          code: match.code,
          slug: match.slug || undefined,
          name: match.name,
          price: match.price,
          durationMin: match.durationMin,
          specialtyId: match.specialtyId,
          specialtyName: match.specialtyName,
          priority: ['HIGH', 'MEDIUM', 'LOW'].includes(sel.priority) ? sel.priority : 'MEDIUM',
          badge: sel.badge || (finalSourceType === 'SEARCH_INTENT' ? 'Phù hợp tìm kiếm' : 'Đề xuất chuyên khoa'),
          clinicalReason: sel.clinicalReason || 'Phù hợp với nhu cầu tầm soát và thể trạng sức khỏe.',
          sourceType: finalSourceType,
        });
      }

      return result;
    } catch (err: any) {
      this.logger.warn(`[AI Re-ranking] Gemini call failed (${err?.message}) -> Fallback heuristics`);
      return [];
    }
  }

  // Tách riêng phần tạo Prompt
  private buildHybridPrompt(context: {
    profile: {
      fullName: string;
      age: number;
      gender: string;
      bmi: number | null;
      medicalHistory: string;
      allergies: string;
    } | null;
    behaviorContext: {
      topSpecialties: string;
      lastSearchQuery: string;
      dropOffPkgName?: string;
    };
    candidates: Array<{
      id: string;
      name: string;
      code: string;
      slug?: string;
      description: string;
      price: number;
      specialtyName: string;
      specialtyId: number | null;
      durationMin: number;
      origin: string;
      behaviorSourceType?: string;
    }>;
  }): string {
    return `
Bạn là Bác sĩ Trưởng Hội đồng Khám sàng lọc & Y học Dự phòng tại VitaCare Clinic.
Hãy đánh giá hồ sơ bệnh nhân và hành vi quan tâm gần đây để Re-rank và chọn ra từ 4 đến 6 gói khám y tế tối ưu nhất từ danh sách ứng viên được cung cấp.

THÔNG TIN BỆNH NHÂN:
${context.profile ? `
- Họ tên: ${context.profile.fullName}
- Tuổi: ${context.profile.age} tuổi
- Giới tính: ${context.profile.gender}
- Chỉ số BMI: ${context.profile.bmi ?? 'Chưa ghi nhận'}
- Tiền sử bệnh án mạn tính: "${context.profile.medicalHistory || 'Không ghi nhận'}"
- Tiền sử dị ứng: "${context.profile.allergies || 'Không ghi nhận'}"
` : 'Khách vãng lai (Chưa đăng nhập / Chưa chọn hồ sơ).'}

NGỮ CẢNH HÀNH VI TƯƠNG TÁC TỨC THỜI:
- Chuyên khoa có điểm quan tâm cao: ${context.behaviorContext.topSpecialties}
- Từ khóa tìm kiếm triệu chứng gần nhất: "${context.behaviorContext.lastSearchQuery}"
${context.behaviorContext.dropOffPkgName ? `- Gói khám từng quan tâm/bỏ dở: "${context.behaviorContext.dropOffPkgName}"` : ''}

DANH SÁCH GÓI KHÁM ỨNG VIÊN (${context.candidates.length} gói):
${JSON.stringify(
      context.candidates.map((c) => ({
        id: c.id,
        name: c.name,
        specialty: c.specialtyName,
        price: c.price,
        origin: c.origin,
        behaviorSourceType: c.behaviorSourceType || 'NONE',
        description: (c.description || '').slice(0, 100),
      }))
    )}

QUY TẮC RE-RANKING:
1. SỐ LƯỢNG KẾT QUẢ: Chọn ra từ 4 đến 6 gói khám phù hợp nhất.
2. NGUYÊN TẮC ĐỀ XUẤT:
   - Nếu CÓ HỒ SƠ: Ưu tiên theo tiền sử/bệnh nền, tuổi tác và giới tính của hồ sơ.
   - Nếu LÀ HÀNH VI/KHÁCH VÃNG LAI: Ưu tiên theo mối quan tâm chuyên khoa, từ khóa tìm kiếm và các gói vừa quan tâm gần đây.
3. PHÂN LOẠI NGUỒN GỢI Ý (sourceType): "DROP_OFF" | "SEARCH_INTENT" | "RECENT_VIEW" | "PROFILE_AI" | "POPULAR".
4. MỨC ĐỘ ƯU TIÊN (priority): "HIGH" | "MEDIUM" | "LOW".
5. NHÃN (badge): Ngắn gọn 2-4 từ (Ví dụ: "Theo hồ sơ bệnh án", "Nhu cầu vừa tìm", "Quan tâm gần đây", "Tầm soát định kỳ").
6. LÝ DO ĐỀ XUẤT (clinicalReason): Viết 1-2 câu giải thích chuyên môn y khoa sâu sắc:
   - Khi có hồ sơ: Nêu rõ căn cứ theo độ tuổi và tiền sử bệnh của bệnh nhân.
   - Khi theo hành vi: Giải thích dựa trên nhu cầu tìm kiếm và chuyên khoa người dùng vừa quan tâm gần đây.
`;
  }

  // Parse JSON an toàn chống Markdown Block
  private safeParseSelections(rawText?: string): any[] {
    if (!rawText) return [];
    try {
      let cleaned = rawText.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
      }
      const parsed = JSON.parse(cleaned);
      return Array.isArray(parsed?.selectedPackages) ? parsed.selectedPackages : [];
    } catch {
      return [];
    }
  }

  private resolveSourceType(
    aiSourceType: string | undefined,
    candidate: any,
  ): 'DROP_OFF' | 'SEARCH_INTENT' | 'RECENT_VIEW' | 'PROFILE_AI' | 'POPULAR' {
    const validSources = ['DROP_OFF', 'SEARCH_INTENT', 'RECENT_VIEW', 'PROFILE_AI', 'POPULAR'];
    if (aiSourceType && validSources.includes(aiSourceType)) {
      return aiSourceType as any;
    }
    if (candidate.behaviorSourceType) return candidate.behaviorSourceType;
    if (candidate.origin === 'PROFILE') return 'PROFILE_AI';
    return 'POPULAR';
  }

  // fallback
  evaluateHybridWithHeuristics(
    candidatePool: CandidatePoolItem[],
    profile: any,
    medicalHistory: string,
  ): RecommendedPackageItemDto[] {
    const list: RecommendedPackageItemDto[] = [];
    const usedIds = new Set<string>();

    for (const item of candidatePool) {
      if (usedIds.has(item.pkg.id)) continue;
      usedIds.add(item.pkg.id);

      let priority: RecommendationPriority = 'MEDIUM';
      let badge = 'Đề xuất y khoa';
      let reason = 'Gói khám tiêu biểu được hội đồng y khoa VitaCare khuyến nghị thực hiện.';
      let sourceType: 'DROP_OFF' | 'SEARCH_INTENT' | 'RECENT_VIEW' | 'PROFILE_AI' | 'POPULAR' = 'POPULAR';

      if (item.isFollowUp) {
        priority = 'HIGH';
        badge = 'Tái khám theo hẹn';
        reason = 'Khuyến nghị tái khám định kỳ để đánh giá đáp ứng điều trị.';
        sourceType = 'PROFILE_AI';
      } else if (item.origin === 'BEHAVIOR') {
        if (item.behaviorSourceType === 'DROP_OFF') {
          priority = 'HIGH';
          badge = 'Tiếp tục đăng ký';
          reason = 'Gói khám bạn đang quan tâm đặt lịch gần đây.';
          sourceType = 'DROP_OFF';
        } else if (item.behaviorSourceType === 'SEARCH_INTENT') {
          priority = 'HIGH';
          badge = 'Phù hợp tìm kiếm';
          reason = 'Gói khám tương ứng với triệu chứng bạn vừa tìm kiếm.';
          sourceType = 'SEARCH_INTENT';
        } else {
          priority = 'MEDIUM';
          badge = 'Quan tâm gần đây';
          reason = 'Dựa trên mối quan tâm chuyên khoa gần đây của bạn.';
          sourceType = 'RECENT_VIEW';
        }
      } else if (item.origin === 'PROFILE') {
        priority = list.length === 0 ? 'HIGH' : 'MEDIUM';
        badge = 'Khám sàng lọc ban đầu';
        reason = medicalHistory
          ? `Phù hợp tiền sử: ${medicalHistory} · Khuyến nghị tầm soát chuyên sâu.`
          : 'Khuyến nghị tầm soát và đánh giá sức khỏe chuyên khoa định kỳ.';
        sourceType = 'PROFILE_AI';
      }

      list.push({
        packageId: item.pkg.id,
        code: item.pkg.code,
        slug: item.pkg.slug || undefined,
        name: item.pkg.name,
        price: Number(item.pkg.price),
        durationMin: item.pkg.durationMin,
        specialtyId: item.pkg.specialtyId,
        specialtyName: item.pkg.specialty?.name || 'Đa khoa',
        priority,
        badge,
        clinicalReason: reason,
        sourceType,
      });

      if (list.length >= 6) break;
    }

    return list;
  }

  // tạo tag cho gói khám
  async suggestSymptomsForPackage(name: string, specialtyName?: string): Promise<{ symptoms: string[] }> {
    if (!name?.trim()) return { symptoms: [] };
    if (this.aiClient) {
      try {
        const prompt = `Bạn là trợ lý y khoa AI của phòng khám VitaCare.
Hãy phân tích dịch vụ / gói khám: "${name.trim()}" (Chuyên khoa: "${specialtyName?.trim() || 'Đa khoa'}").
Liệt kê 10-15 triệu chứng lâm sàng phổ biến nhất bằng JSON array các chuỗi string ngắn gọn: ["triệu chứng 1", "triệu chứng 2", ...]`;
        const res = await this.aiClient.models.generateContent({
          model: this.modelName || 'gemini-2.5-flash',
          contents: prompt,
        });
        let raw = res.text?.trim() || '[]';
        if (raw.startsWith('```')) raw = raw.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return { symptoms: [...new Set(parsed.map((s: any) => String(s).trim().toLowerCase()))] };
        }
      } catch { }
    }
    return { symptoms: [] };
  }
}
