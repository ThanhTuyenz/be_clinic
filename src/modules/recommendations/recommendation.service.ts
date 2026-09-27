import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI, Type } from '@google/genai';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import { ProfileRecommendationResponseDto, RecommendedPackageItemDto } from './recommendation.dto.js';
import { EmbeddingService, PackageForRetrieval } from '../../infrastructure/embedding/embedding.service.js';

@Injectable()
export class RecommendationService {
  private readonly logger = new Logger(RecommendationService.name);
  private aiClient: GoogleGenAI | null = null;
  private readonly modelName: string;
  private readonly CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 ngày

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly embeddingService: EmbeddingService,
  ) {
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

  /**
   * get ds gói khám phù hợp (cache -> fail -> phân tích lại ).
   */
  async getRecommendations(profileId: string, branchId?: string): Promise<ProfileRecommendationResponseDto> {
    const t0 = Date.now();
    const cacheKey = this.buildCacheKey(profileId);

    // 1. Kiểm tra Redis
    try {
      if (this.redis.isEnabled()) {
        const cached = await this.redis.get<ProfileRecommendationResponseDto>(cacheKey);
        if (cached && Array.isArray(cached.packages) && cached.packages.length > 0) {
          const latency = Date.now() - t0;
          this.logger.log(
            `[Recommendation] [CACHE HIT] Found recommendations for profile "${profileId}" in Redis [key: ${cacheKey}] (${cached.packages.length} packages, ${latency}ms)`,
          );
          return { ...cached, source: 'REDIS_CACHE' };
        }
      }
    } catch (err: any) {
      this.logger.warn(`Redis get failed for key ${cacheKey}: ${err?.message}`);
    }

    // 2. Cache miss -> analyst lại 
    this.logger.log(`[Recommendation CACHE MISS] No valid cache for profile "${profileId}". Starting full pipeline...`);
    return this.analyzeAndCacheRecommendations(profileId, branchId);
  }

  /**
   * Kích hoạt xử lý ngầm (Non-blocking / Background qua RabbitMQ Outbox).
   * Dùng khi tạo hoặc sửa hồ sơ bệnh nhân, không làm chậm response của user.
   */
  triggerAsyncRecommendation(profileId: string): void {
    void this.enqueueRecommendationTask(profileId);
  }

  private async enqueueRecommendationTask(profileId: string): Promise<void> {
    try {
      await this.prisma.outboxEvent.create({
        data: {
          aggregateType: 'PatientProfile',
          aggregateId: profileId,
          eventType: 'recommendation.profile.analyze',
          payload: { profileId },
        },
      });
      this.logger.log(`Enqueued recommendation task [recommendation.profile.analyze] for profile ${profileId}`);
    } catch (err: any) {

      // không chạy luông bacground job
      this.logger.warn(`Failed to create outbox event for profile ${profileId}, falling back to setImmediate: ${err?.message}`);
      setImmediate(() => {
        this.analyzeAndCacheRecommendations(profileId).catch((fallbackErr) => {
          this.logger.error(`Fallback recommendation analysis failed for profile ${profileId}: ${fallbackErr?.message}`);
        });
      });
    }
  }

  /**
   * Xóa cache của một hồ sơ khi bệnh nhân sửa thông tin hoặc hoàn tất lịch khám mới.
   */
  async invalidateCache(profileId: string): Promise<void> {
    try {
      if (this.redis.isEnabled()) {
        const key = this.buildCacheKey(profileId);
        await this.redis.delete(key);
        // Xóa thêm legacy key nếu có
        await this.redis.delete(`${key}:all`);
        this.logger.log(`Invalidated recommendation cache for profile ${profileId}`);
      }
    } catch (err: any) {
      this.logger.warn(`Failed to invalidate cache for profile ${profileId}: ${err?.message}`);
    }
  }

  /**
   * Thực hiện phân tích chuyên sâu bằng AI (hoặc Heuristic Fallback) và lưu vào Redis.
   */
  async analyzeAndCacheRecommendations(
    profileId: string,
    branchId?: string,
  ): Promise<ProfileRecommendationResponseDto> {
    const t0 = Date.now();
    this.logger.log(`==================== [RECOMMENDATION PIPELINE START] Profile: ${profileId} ====================`);

    // 1. Lấy thông tin hồ sơ bệnh nhân (chỉ select các trường lâm sàng cần thiết)
    const profile = await this.prisma.patientProfile.findUnique({
      where: { id: profileId },
      select: {
        id: true,
        fullName: true,
        dateOfBirth: true,
        gender: true,
        height: true,
        weight: true,
        medicalHistory: true,
        allergies: true,
      },
    });

    if (!profile) {
      this.logger.warn(`[RECOMMENDATION] Profile not found: ${profileId}`);
      return {
        profileId,
        updatedAt: new Date().toISOString(),
        source: 'RULE_FALLBACK',
        packages: [],
      };
    }

    // 2. Tính toán các chỉ số lâm sàng
    const dob = profile.dateOfBirth ? new Date(profile.dateOfBirth) : null;
    const age = dob && !isNaN(dob.getTime())
      ? Math.abs(new Date(Date.now() - dob.getTime()).getUTCFullYear() - 1970)
      : 30;
    const height = profile.height ? Number(profile.height) : 0;
    const weight = profile.weight ? Number(profile.weight) : 0;
    const bmi = height > 50 && weight > 10 ? +(weight / ((height / 100) * (height / 100))).toFixed(1) : null;
    const medicalHistory = (profile.medicalHistory || '').trim();
    const allergies = (profile.allergies || '').trim();
    const gender = (profile.gender || 'OTHER').toString().toUpperCase();

    // 3. Lấy danh sách gói khám đang hoạt động (tối ưu select và lọc theo cơ sở nếu có)
    const allActivePackages = await this.prisma.servicePackage.findMany({
      where: {
        isActive: true,
        ...(branchId ? { branchBookingMethod: { branchId, isEnabled: true } } : {}),
      },
      select: {
        id: true,
        code: true,
        slug: true,
        name: true,
        description: true,
        symptoms: true,
        price: true,
        durationMin: true,
        specialtyId: true,
        specialty: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { price: 'asc' },
    });

    if (allActivePackages.length === 0) {
      return {
        profileId,
        profileName: profile.fullName,
        updatedAt: new Date().toISOString(),
        source: 'RULE_FALLBACK',
        packages: [],
      };
    }

    // 4. Kiểm tra ls tái khái ưu tiên hiển thị
    const pastAppointments = await this.prisma.appointment.findMany({
      where: {
        patientProfileId: profileId,
        status: { in: ['COMPLETED', 'CONFIRMED', 'CHECKED_IN'] },
      },
      select: {
        id: true,
        servicePackageId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        servicePackage: {
          select: {
            id: true,
            name: true,
            code: true,
            specialtyId: true,
            specialty: { select: { id: true, name: true } },
          },
        },
        scheduleSlot: {
          select: {
            schedule: {
              select: {
                doctor: {
                  select: {
                    id: true,
                    specialties: {
                      select: {
                        isPrimary: true,
                        specialtyId: true,
                        specialty: { select: { id: true, name: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    // Lọc các gói vừa khám trong 30 ngày để tránh spam
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const suppressedPackageIds = new Set<string>();
    for (const app of pastAppointments) {
      if (!app.servicePackageId) continue;
      const appTime = new Date(app.createdAt).getTime();
      if (!isNaN(appTime) && appTime >= thirtyDaysAgo.getTime()) {
        suppressedPackageIds.add(app.servicePackageId);
      }
    }

    // TẦNG 1: RULE TÁI KHÁM (0ms, không dùng AI, chính xác tuyệt đối)
    const completedAppointments = pastAppointments.filter((app) => app.status === 'COMPLETED');
    let followUpRecommendation: RecommendedPackageItemDto | null = null;
    const usedPackageIds = new Set<string>();

    this.logger.log(
      `[STAGE 2/6: CLINICAL RULES & RECENCY] 📅 Found ${pastAppointments.length} appointments (${completedAppointments.length} COMPLETED)`,
    );

    if (completedAppointments.length > 0) {
      const latest = completedAppointments[0];
      const primaryDocSpecialty =
        latest.scheduleSlot?.schedule?.doctor?.specialties?.find((s) => s.isPrimary) ||
        latest.scheduleSlot?.schedule?.doctor?.specialties?.[0];

      const specialtyId = latest.servicePackage?.specialtyId || primaryDocSpecialty?.specialtyId;
      const specialtyName =
        latest.servicePackage?.specialty?.name ||
        primaryDocSpecialty?.specialty?.name ||
        'Chuyên khoa';

      const visitDate = new Date(latest.updatedAt || latest.createdAt);
      const daysAgo = Math.max(1, Math.floor((Date.now() - visitDate.getTime()) / (24 * 60 * 60 * 1000)));

      if (specialtyId) {
        // Tìm gói tái khám tương ứng cùng chuyên khoa trong database
        const followUpPkg = allActivePackages.find(
          (p) =>
            p.specialtyId === specialtyId &&
            (p.code.endsWith('-FOLLOWUP') || p.name.toLowerCase().includes('tái khám'))
        );

        if (followUpPkg) {
          usedPackageIds.add(followUpPkg.id);
          followUpRecommendation = {
            packageId: followUpPkg.id,
            code: followUpPkg.code,
            name: followUpPkg.name,
            price: Number(followUpPkg.price),
            durationMin: followUpPkg.durationMin,
            specialtyId: followUpPkg.specialtyId,
            specialtyName: followUpPkg.specialty?.name || specialtyName,
            priority: 'HIGH',
            badge: daysAgo <= 45 ? 'Tái khám theo hẹn' : 'Tái khám định kỳ',
            clinicalReason: `Bệnh nhân đã hoàn thành đợt khám ${specialtyName} (${daysAgo} ngày trước) · Khuyến nghị tái khám để đánh giá đáp ứng điều trị và điều chỉnh phác đồ.`,
          };

          this.logger.log(
            `[STAGE 2/6: CLINICAL RULES & RECENCY] 🎯 [FOLLOW-UP MATCH] Priority #1 -> "${followUpPkg.name}" (${followUpPkg.code}) | Visited: ${daysAgo} days ago | Badge: "${followUpRecommendation.badge}"`,
          );
        }
      }
    }

    if (!followUpRecommendation) {
      this.logger.log(`[STAGE 2/6: CLINICAL RULES & RECENCY] ℹ️ [FOLLOW-UP] None (No completed appointment eligible for follow-up)`);
    }

    if (suppressedPackageIds.size > 0) {
      this.logger.log(
        `[STAGE 2/6: CLINICAL RULES & RECENCY] ⏳ [SUPPRESSION] ${suppressedPackageIds.size} packages suppressed (completed within 30 days)`,
      );
    }

    // TẦNG 1: LỌC DANH SÁCH ỨNG VIÊN BẰNG LUẬT LÂM SÀNG & METADATA (Rule & Metadata Pre-Filtering)
    const screeningCandidates = allActivePackages.filter((pkg) => {
      const isFollowUpPkg = pkg.code.endsWith('-FOLLOWUP') || pkg.name.toLowerCase().includes('tái khám');
      if (isFollowUpPkg) return false;
      if (usedPackageIds.has(pkg.id)) return false;
      if (suppressedPackageIds.has(pkg.id)) return false;

      // Lọc cứng giới tính & độ tuổi
      if (!this.isPackageAppropriateForGender(pkg.name, pkg.description || '', gender)) return false;
      if (!this.isPackageAppropriateForAge(pkg.name, pkg.description || '', age)) return false;

      return true;
    });

    this.logger.log(
      `[STAGE 2/6: CLINICAL RULES & RECENCY] 🔍 [PRE-FILTER] Filtered ${allActivePackages.length} -> ${screeningCandidates.length} screening candidates (excluded gender/age mismatch, follow-up & suppressed packages)`,
    );

    let aiRecommendedList: RecommendedPackageItemDto[] = [];
    let source: 'AI_GEMINI' | 'RULE_FALLBACK' = 'RULE_FALLBACK';

    if (screeningCandidates.length > 0) {
      // TẦNG 2: SEMANTIC VECTOR RETRIEVAL (Rút gọn từ hàng trăm/nghìn gói xuống Top 15 - 20 gói ứng viên y khoa sáng giá)
      const patientEmbeddingText = this.embeddingService.buildPatientEmbeddingText({
        fullName: profile.fullName,
        age,
        gender,
        bmi,
        medicalHistory,
        allergies,
      });

      this.logger.log(`[STAGE 3/6: VECTOR RETRIEVAL] 📝 Patient Semantic Text: "${patientEmbeddingText}"`);

      const candidateObjects: PackageForRetrieval[] = screeningCandidates.map((p) => ({
        id: p.id,
        name: p.name,
        code: p.code,
        description: p.description || '',
        symptoms: p.symptoms || [],
        price: Number(p.price),
        specialtyName: p.specialty?.name || 'Đa khoa',
        specialtyId: p.specialtyId,
        durationMin: p.durationMin,
      }));

      // Rút gọn danh sách ứng viên thông qua Vector Search (Cosine Similarity)
      const tRetrieval = Date.now();
      const topRetrieved = await this.embeddingService.retrieveTopPackages(
        patientEmbeddingText,
        candidateObjects,
        20,
      );
      const topCandidates = topRetrieved.map((r) => r.package);

      this.logger.log(
        `[STAGE 3/6: VECTOR RETRIEVAL] 📊 Retrieved Top ${topCandidates.length} candidates in ${Date.now() - tRetrieval}ms. Previews:`,
      );
      topRetrieved.slice(0, 3).forEach((r, idx) => {
        this.logger.log(`   #${idx + 1} [Score: ${r.score.toFixed(3)}] ${r.package.name} (${r.package.specialtyName})`);
      });

      // TẦNG 3: DEEP CLINICAL RE-RANKING VỚI GEMINI LLM (Chỉ nạp Top 15-20 gói vào prompt)
      if (this.aiClient) {
        try {
          this.logger.log(
            `[STAGE 4/6: GEMINI LLM RE-RANKING] 🤖 Prompting model "${this.modelName}" with ${topCandidates.length} candidates...`,
          );
          aiRecommendedList = await this.evaluateWithGemini({
            profile: {
              fullName: profile.fullName,
              age,
              gender,
              bmi,
              medicalHistory,
              allergies,
            },
            candidates: topCandidates,
          });
          if (aiRecommendedList.length > 0) {
            source = 'AI_GEMINI';
          }
        } catch (err: any) {
          this.logger.warn(`[STAGE 4/6: GEMINI LLM RE-RANKING] ⚠️ Gemini evaluation failed (${err?.message}) -> Falling back to clinical rules`);
        }
      }

      if (aiRecommendedList.length === 0) {
        this.logger.log(`[STAGE 4/6: CLINICAL HEURISTICS] 📋 Running Expert Clinical Rules Fallback...`);
        aiRecommendedList = this.evaluateWithClinicalHeuristics({
          age,
          gender,
          bmi,
          medicalHistory,
          candidates: screeningCandidates.filter((p) => topCandidates.some((tc) => tc.id === p.id)),
        });
        this.logger.log(`[STAGE 4/6: CLINICAL HEURISTICS] Matched ${aiRecommendedList.length} packages by rules.`);
      }
    }

    // TỔNG HỢP HYBRID: [Gói Tái khám từ Rule] + [Tất cả gói Tầm soát từ AI]
    const finalList: RecommendedPackageItemDto[] = [];
    if (followUpRecommendation) {
      finalList.push(followUpRecommendation);
    }
    for (const item of aiRecommendedList) {
      // Không giới hạn số lượng — chỉ tránh trùng lặp
      if (!finalList.some((x) => x.packageId === item.packageId)) {
        finalList.push(item);
      }
    }

    this.logger.log(
      `[STAGE 5/6: HYBRID AGGREGATION] 🔗 Merged: ${followUpRecommendation ? '1 Follow-up' : '0 Follow-up'} + ${aiRecommendedList.length} Screening = ${finalList.length} Total Packages:`,
    );
    finalList.forEach((pkg, idx) => {
      this.logger.log(
        `   #${idx + 1} [${pkg.priority}] [${pkg.badge}] ${pkg.name} (${pkg.code}) - ${pkg.price.toLocaleString('vi-VN')} đ | Lý do: ${pkg.clinicalReason}`,
      );
    });

    const result: ProfileRecommendationResponseDto = {
      profileId,
      profileName: profile.fullName,
      updatedAt: new Date().toISOString(),
      source,
      packages: finalList,
    };

    // 7. Chỉ lưu vào Redis Cache khi kết quả được phân tích thành công bởi AI_GEMINI (TTL 7 ngày)
    // Dữ liệu Fallback tuyệt đối KHÔNG lưu cache để các lượt truy cập sau tự động thử lại với Gemini AI
    if (source === 'AI_GEMINI') {
      try {
        if (this.redis.isEnabled()) {
          const cacheKey = this.buildCacheKey(profileId);
          await this.redis.set(cacheKey, result, this.CACHE_TTL_SECONDS);
          this.logger.log(
            `[STAGE 6/6: CACHE & PERFORMANCE] 💾 Cached AI recommendations in Redis [key: ${cacheKey}] (TTL: 7 days / ${this.CACHE_TTL_SECONDS}s)`,
          );
        }
      } catch (err: any) {
        this.logger.warn(`Failed to set Redis cache: ${err?.message}`);
      }
    } else {
      this.logger.log(
        `[STAGE 6/6: CACHE & PERFORMANCE] ⏭️ Skipped Redis cache for RULE_FALLBACK (will retry Gemini AI on next visit)`,
      );
    }

    const totalDuration = Date.now() - t0;
    this.logger.log(
      `==================== 🏁 [RECOMMENDATION COMPLETE] Profile: ${profileId} | ${finalList.length} Packages | Time: ${totalDuration}ms | Source: ${source} ====================`,
    );

    return result;
  }

  /**
   * Gọi Gemini 2.0 / 1.5 với Structured JSON Schema để chọn ra 2-4 gói khám phù hợp nhất
   */
  private async evaluateWithGemini(context: {
    profile: {
      fullName: string;
      age: number;
      gender: string;
      bmi: number | null;
      medicalHistory: string;
      allergies: string;
    };
    candidates: Array<{
      id: string;
      name: string;
      code: string;
      description: string;
      price: number;
      specialtyName: string;
      specialtyId: number | null;
      durationMin: number;
    }>;
  }): Promise<RecommendedPackageItemDto[]> {
    if (!this.aiClient) return [];

    const prompt = `
Bạn là Bác sĩ Trưởng khoa Khám sàng lọc ban đầu. Hãy phân tích hồ sơ bệnh nhân và đề xuất TẤT CẢ các gói khám y tế phù hợp từ danh sách gói khám thực tế được cung cấp để tầm soát và phát hiện sớm các nguy cơ sức khỏe. Không giới hạn số lượng gói — chỉ chọn những gói thực sự phù hợp với tình trạng sức khỏe của bệnh nhân.

THÔNG TIN BỆNH NHÂN:
- Họ tên: ${context.profile.fullName}
- Tuổi: ${context.profile.age} tuổi
- Giới tính: ${context.profile.gender}
- Chỉ số thể trạng BMI: ${context.profile.bmi ?? 'Chưa ghi nhận'}
- Tiền sử bệnh lý mạn tính: "${context.profile.medicalHistory || 'Không ghi nhận'}"
- Tiền sử dị ứng: "${context.profile.allergies || 'Không ghi nhận'}"

DANH MỤC GÓI KHÁM TẦM SOÁT THỰC TẾ ĐANG HOẠT ĐỘNG (toàn bộ danh sách):
${JSON.stringify(
      context.candidates.map((c) => ({
        id: c.id,
        name: c.name,
        specialty: c.specialtyName,
        price: c.price,
        description: (c.description || '').slice(0, 120),
      }))
    )}

QUY TẮC Y KHOA BẮT BUỘC:
1. Đa chuyên khoa (Comorbidities): Nếu bệnh nhân có nhiều bệnh nền (ví dụ vừa huyết áp, vừa tiểu đường, vừa đau khớp), hãy chọn các gói thuộc các chuyên khoa khác nhau để giải quyết toàn diện.
2. Xếp hạng ưu tiên (priority):
   - "HIGH": Gói cấp thiết nhất tương ứng với bệnh lý chính hoặc nguy cơ cao nhất.
   - "MEDIUM": Gói tầm soát các nguy cơ thứ hai hoặc theo độ tuổi/thể trạng.
   - "LOW": Gói chăm sóc định kỳ bổ trợ.
3. Huy hiệu nhãn (badge): Đặt ngắn gọn như "Khám sàng lọc ban đầu" hoặc "Tầm soát định kỳ" hoặc "Theo dõi [Tên bệnh]".
4. Lý do lâm sàng (clinicalReason): Viết ngắn gọn 1-2 câu giải thích vì sao gói này phù hợp dựa trên tiền sử/thể trạng thực tế của bệnh nhân.
5. Chỉ chọn các ID có thật trong danh sách được cung cấp. Không tự bịa ra gói khám mới.
`;

    const tGemini = Date.now();
    const response = await this.aiClient.models.generateContent({
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
                },
                required: ['packageId', 'priority', 'badge', 'clinicalReason'],
              },
            },
          },
          required: ['selectedPackages'],
        },
      },
    });

    const geminiDuration = Date.now() - tGemini;
    const parsed = JSON.parse(response.text || '{}');
    const selections = Array.isArray(parsed.selectedPackages) ? parsed.selectedPackages : [];

    this.logger.log(
      `[STAGE 4/6: GEMINI LLM RE-RANKING] ✨ Gemini completed in ${geminiDuration}ms. Model selected ${selections.length} packages:`,
    );
    selections.forEach((sel) => {
      this.logger.log(`   • [${sel.priority}] [${sel.badge}] PkgID: ${sel.packageId} -> "${sel.clinicalReason}"`);
    });

    const result: RecommendedPackageItemDto[] = [];
    for (const sel of selections) {
      const match = context.candidates.find((c) => c.id === sel.packageId);
      if (match) {
        result.push({
          packageId: match.id,
          code: match.code,
          name: match.name,
          price: match.price,
          durationMin: match.durationMin,
          specialtyId: match.specialtyId,
          specialtyName: match.specialtyName,
          priority: ['HIGH', 'MEDIUM', 'LOW'].includes(sel.priority) ? sel.priority : 'MEDIUM',
          badge: sel.badge || 'Khuyến nghị chuyên khoa',
          clinicalReason: sel.clinicalReason || 'Phù hợp với thể trạng và hồ sơ bệnh nhân',
        });
      }
    }

    return result;
  }

  /**
   * Bộ luật chuyên gia lâm sàng (Clinical Heuristics) chạy dự phòng khi không có AI
   */
  private evaluateWithClinicalHeuristics(context: {
    age: number;
    gender: string;
    bmi: number | null;
    medicalHistory: string;
    candidates: any[];
  }): RecommendedPackageItemDto[] {
    const medHistory = context.medicalHistory.toLowerCase();
    const isFemale = context.gender === 'FEMALE' || context.gender === 'NỮ';
    const isElderly = context.age >= 55;
    const bmiHigh = context.bmi !== null && context.bmi >= 25;

    const list: RecommendedPackageItemDto[] = [];
    const usedIds = new Set<string>();

    // 1. Tim mạch / Huyết áp
    if (
      medHistory.includes('huyết áp') ||
      medHistory.includes('tim mạch') ||
      medHistory.includes('mỡ máu') ||
      medHistory.includes('cholesterol') ||
      medHistory.includes('đột quỵ')
    ) {
      const p = context.candidates.find(
        (c) =>
          !usedIds.has(c.id) &&
          (c.code === 'PKG-CARDIO-SCREENING' ||
            c.name.toLowerCase().includes('tim mạch') ||
            c.specialty?.name.toLowerCase().includes('tim mạch'))
      );
      if (p) {
        usedIds.add(p.id);
        list.push({
          packageId: p.id,
          code: p.code,
          name: p.name,
          price: Number(p.price),
          durationMin: p.durationMin,
          specialtyId: p.specialtyId,
          specialtyName: p.specialty?.name || 'Tim mạch',
          priority: 'HIGH',
          badge: 'Khám sàng lọc ban đầu',
          clinicalReason: context.medicalHistory
            ? `Tiền sử: ${context.medicalHistory} · Khuyến nghị đo điện tim ECG & siêu âm tim`
            : 'Khuyến nghị đánh giá nguy cơ tim mạch & chức năng tuần hoàn',
        });
      }
    }

    // 2. Nội tiết / Tiểu đường / BMI cao
    if (medHistory.includes('đái tháo đường') || medHistory.includes('tiểu đường') || bmiHigh) {
      const p = context.candidates.find(
        (c) =>
          !usedIds.has(c.id) &&
          (c.name.toLowerCase().includes('đường') ||
            c.name.toLowerCase().includes('chuyển hóa') ||
            c.code === 'PKG-GENERAL-BASIC' ||
            c.name.toLowerCase().includes('tổng quát'))
      );
      if (p) {
        usedIds.add(p.id);
        list.push({
          packageId: p.id,
          code: p.code,
          name: p.name,
          price: Number(p.price),
          durationMin: p.durationMin,
          specialtyId: p.specialtyId,
          specialtyName: p.specialty?.name || 'Nội tiết - Chuyển hóa',
          priority: list.length === 0 ? 'HIGH' : 'MEDIUM',
          badge: bmiHigh ? 'Theo dõi Chuyển hóa & BMI' : 'Khám sàng lọc ban đầu',
          clinicalReason: bmiHigh
            ? `Chỉ số BMI ${context.bmi} (thừa cân) · Khuyến nghị xét nghiệm đường huyết và mỡ máu`
            : 'Khuyến nghị theo dõi chỉ số đường huyết định kỳ',
        });
      }
    }

    // 3. Nữ giới / Phụ khoa
    if (isFemale) {
      const p = context.candidates.find(
        (c) =>
          !usedIds.has(c.id) &&
          (c.code === 'PKG-WOMEN-WELLNESS' ||
            c.name.toLowerCase().includes('nữ') ||
            c.specialty?.name.toLowerCase().includes('sản'))
      );
      if (p) {
        usedIds.add(p.id);
        list.push({
          packageId: p.id,
          code: p.code,
          name: p.name,
          price: Number(p.price),
          durationMin: p.durationMin,
          specialtyId: p.specialtyId,
          specialtyName: p.specialty?.name || 'Sản - Phụ khoa',
          priority: list.length === 0 ? 'HIGH' : 'MEDIUM',
          badge: 'Chăm sóc Sức khỏe Nữ',
          clinicalReason: 'Khuyến nghị kiểm tra định kỳ sức khỏe phụ khoa & tầm soát chuyên sâu hàng năm',
        });
      }
    }

    // 4. Mắt hoặc Người cao tuổi
    if (isElderly || medHistory.includes('mắt') || medHistory.includes('thị lực')) {
      const p = context.candidates.find(
        (c) =>
          !usedIds.has(c.id) &&
          (c.code.includes('EYE') ||
            c.name.toLowerCase().includes('mắt') ||
            c.specialty?.name.toLowerCase().includes('mắt'))
      );
      if (p) {
        usedIds.add(p.id);
        list.push({
          packageId: p.id,
          code: p.code,
          name: p.name,
          price: Number(p.price),
          durationMin: p.durationMin,
          specialtyId: p.specialtyId,
          specialtyName: p.specialty?.name || 'Mắt',
          priority: 'LOW',
          badge: 'Chăm sóc Thị lực',
          clinicalReason: 'Khuyến nghị kiểm tra thị lực và tầm soát đáy mắt định kỳ',
        });
      }
    }

    // 5. Gói tổng quát nếu chưa đủ 2 gói
    if (list.length < 2) {
      const p = context.candidates.find(
        (c) =>
          !usedIds.has(c.id) &&
          (c.code === 'PKG-GENERAL-BASIC' || c.name.toLowerCase().includes('tổng quát'))
      );
      if (p) {
        usedIds.add(p.id);
        list.push({
          packageId: p.id,
          code: p.code,
          name: p.name,
          price: Number(p.price),
          durationMin: p.durationMin,
          specialtyId: p.specialtyId,
          specialtyName: p.specialty?.name || 'Đa khoa',
          priority: list.length === 0 ? 'HIGH' : 'LOW',
          badge: 'Khám Tổng Quát Định Kỳ',
          clinicalReason: 'Khuyến nghị kiểm tra định kỳ sức khỏe toàn diện mỗi 6 đến 12 tháng',
        });
      }
    }

    // Nếu vẫn rỗng, lấy gói đầu tiên có sẵn
    if (list.length === 0 && context.candidates.length > 0) {
      const p = context.candidates[0];
      list.push({
        packageId: p.id,
        code: p.code,
        name: p.name,
        price: Number(p.price),
        durationMin: p.durationMin,
        specialtyId: p.specialtyId,
        specialtyName: p.specialty?.name || 'Đa khoa',
        priority: 'HIGH',
        badge: 'Khám Tổng Quát Định Kỳ',
        clinicalReason: 'Khuyến nghị kiểm tra định kỳ sức khỏe toàn diện',
      });
    }

    return list;
  }

  /**
   * Kiểm tra gói khám có phù hợp với giới tính bệnh nhân không (Tránh tuyệt đối nam gợi ý phụ khoa)
   */
  private isPackageAppropriateForGender(name: string, description: string, gender: string): boolean {
    const text = `${name} ${description}`.toLowerCase();
    const g = (gender || '').toUpperCase();
    if (g === 'MALE') {
      const femaleKeywords = [
        'phụ khoa', 'thai sản', 'cổ tử cung', 'buồng trứng', 'mang thai',
        'tiền hôn nhân nữ', 'ung thư vú', 'khám thai', 'sinh sản nữ', 'nữ giới'
      ];
      if (femaleKeywords.some((kw) => text.includes(kw))) return false;
    } else if (g === 'FEMALE') {
      const maleKeywords = [
        'nam khoa', 'tuyến tiền liệt', 'sinh sản nam', 'tiền hôn nhân nam', 'sức khỏe nam giới', 'nam giới'
      ];
      if (maleKeywords.some((kw) => text.includes(kw))) return false;
    }
    return true;
  }

  /**
   * Kiểm tra gói khám có phù hợp với độ tuổi bệnh nhân không (Tránh nhầm Nhi khoa và Lão khoa)
   */
  private isPackageAppropriateForAge(name: string, description: string, age: number): boolean {
    const text = `${name} ${description}`.toLowerCase();
    if (age >= 18) {
      const pediatricsKeywords = ['nhi khoa', 'sơ sinh', 'trẻ em', 'tiêm chủng trẻ em', 'tầm soát dị tật sơ sinh'];
      if (pediatricsKeywords.some((kw) => text.includes(kw))) return false;
    } else if (age < 16) {
      const adultKeywords = ['lão khoa', 'tiền mãn kinh', 'mãn kinh', 'tuyến tiền liệt', 'tiền hôn nhân'];
      if (adultKeywords.some((kw) => text.includes(kw))) return false;
    }
    return true;
  }

  /**
   * Tìm kiếm gói khám bằng Ngôn ngữ tự nhiên / Triệu chứng (Semantic Natural Language Search)
   */
  async semanticSearchPackages(query: string, branchId?: string): Promise<{
    query: string;
    total: number;
    packages: Array<{
      id: string;
      code: string;
      name: string;
      price: number;
      durationMin: number;
      specialtyName: string;
      similarityScore: number;
      description: string;
    }>;
    doctors: Array<{
      id: string;
      fullName: string;
      academicRank: string;
      specialties: string[];
      experienceYears: number;
      avatarUrl?: string | null;
      ratingAverage: number;
    }>;
    branches: Array<{
      id: string;
      code: string;
      name: string;
      address: string;
      phoneNumber?: string;
    }>;
  }> {
    if (!query || !query.trim()) {
      return { query: '', total: 0, packages: [], doctors: [], branches: [] };
    }

    const q = query.trim();

    // Chạy song song: 1. Gói khám (Vector Retrieval), 2. Bác sĩ (Direct DB), 3. Cơ sở y tế (Direct DB)
    const [packageResults, matchedDoctors, matchedBranches] = await Promise.all([
      (async () => {
        const packages = await this.prisma.servicePackage.findMany({
          where: {
            isActive: true,
            ...(branchId ? { branchBookingMethod: { branchId, isEnabled: true } } : {}),
          },
          include: {
            specialty: { select: { id: true, name: true } },
          },
          orderBy: { price: 'asc' },
        });

        const mapped: PackageForRetrieval[] = packages.map((p) => ({
          id: p.id,
          code: p.code,
          name: p.name,
          description: p.description || '',
          symptoms: p.symptoms || [],
          price: Number(p.price),
          durationMin: p.durationMin,
          specialtyId: p.specialtyId,
          specialtyName: p.specialty?.name || 'Đa khoa',
        }));

        const results = await this.embeddingService.searchByNaturalLanguage(q, mapped, 6);
        return results.map((r) => ({
          id: r.package.id,
          code: r.package.code,
          name: r.package.name,
          price: r.package.price,
          durationMin: r.package.durationMin,
          specialtyName: r.package.specialtyName,
          similarityScore: Math.round(r.score * 100) / 100,
          description: r.package.description,
        }));
      })(),

      // Truy vấn trực tiếp PostgreSQL tìm Bác sĩ theo Tên, Học vị hoặc Chuyên khoa
      this.prisma.doctor.findMany({
        where: {
          isActive: true,
          OR: [
            { user: { fullName: { contains: q, mode: 'insensitive' } } },
            { academicRank: { contains: q, mode: 'insensitive' } },
            { specialties: { some: { specialty: { name: { contains: q, mode: 'insensitive' } } } } },
          ],
        },
        take: 4,
        include: {
          user: { select: { id: true, fullName: true, phoneNumber: true, email: true } },
          specialties: { include: { specialty: { select: { id: true, name: true } } } },
        },
      }),

      // Truy vấn trực tiếp PostgreSQL tìm Chi nhánh theo Tên hoặc Địa chỉ
      this.prisma.branch.findMany({
        where: {
          isActive: true,
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { address: { contains: q, mode: 'insensitive' } },
          ],
        },
        take: 3,
        select: {
          id: true,
          code: true,
          name: true,
          address: true,
          phoneNumber: true,
        },
      }),
    ]);

    const formattedDoctors = matchedDoctors.map((doc) => ({
      id: doc.id,
      fullName: doc.user?.fullName || 'Bác sĩ',
      academicRank: doc.academicRank || 'Bác sĩ',
      specialties: doc.specialties.map((s) => s.specialty?.name).filter(Boolean) as string[],
      experienceYears: doc.experienceYears || 0,
      avatarUrl: doc.avatarUrl || null,
      ratingAverage: doc.ratingAverage || 5.0,
    }));

    const formattedBranches = matchedBranches.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      address: b.address || '',
      phoneNumber: b.phoneNumber || '',
    }));

    return {
      query: q,
      total: packageResults.length + formattedDoctors.length + formattedBranches.length,
      packages: packageResults,
      doctors: formattedDoctors,
      branches: formattedBranches,
    };
  }

  /**
   * AI tự động phân tích tên gói / chuyên khoa để gợi ý danh sách triệu chứng liên quan
   */
  async suggestSymptomsForPackage(name: string, specialtyName?: string): Promise<{ symptoms: string[] }> {
    if (!name?.trim()) return { symptoms: [] };

    if (this.aiClient) {
      try {
        const prompt = `Bạn là trợ lý y khoa AI của phòng khám VitaCare.
Hãy phân tích dịch vụ / gói khám sau:
- Tên dịch vụ: "${name.trim()}"
- Chuyên khoa: "${specialtyName?.trim() || 'Đa khoa'}"

Hãy liệt kê 10-15 triệu chứng lâm sàng phổ biến nhất mà người bệnh thường gặp khi cần đăng ký khám gói này.
Bao gồm cả thuật ngữ y học và ngôn ngữ đời sống, khẩu ngữ dân gian thường dùng của người dân Việt Nam (ví dụ: mắc ói, buồn nôn, đau dạ dày, tức ngực, lừ đừ, nhức đầu, chóng mặt, hoa mắt,...).
Chỉ trả về duy nhất 1 JSON array các chuỗi string ngắn gọn, không có giải thích hay markdown code block:
["triệu chứng 1", "triệu chứng 2", ...]`;

        const response = await this.aiClient.models.generateContent({
          model: this.modelName || 'gemini-2.5-flash',
          contents: prompt,
        });

        let rawText = response.text?.trim() || '[]';
        if (rawText.startsWith('```')) {
          rawText = rawText.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
        }

        const parsed = JSON.parse(rawText);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const cleanSymptoms = parsed
            .map((s: any) => String(s).trim().toLowerCase())
            .filter((s: string) => s.length > 1 && s.length < 50);
          return { symptoms: [...new Set(cleanSymptoms)] };
        }
      } catch (err: any) {
        this.logger.warn(`Failed to generate AI symptoms for "${name}": ${err?.message}`);
      }
    }

    return { symptoms: [] };
  }

  private buildCacheKey(profileId: string): string {
    return `rec:profile:${profileId}`;
  }
}
