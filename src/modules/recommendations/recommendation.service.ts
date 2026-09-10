import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI, Type } from '@google/genai';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { RedisService } from '../../infrastructure/cache/redis/redis.service.js';
import { ProfileRecommendationResponseDto, RecommendedPackageItemDto } from './recommendation.dto.js';

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
   * Lấy danh sách gói khám khuyến nghị cho một hồ sơ bệnh nhân.
   * Ưu tiên đọc từ Redis Cache (< 5ms). Nếu cache miss, tự động phân tích và lưu cache.
   */
  async getRecommendations(profileId: string, _branchId?: string): Promise<ProfileRecommendationResponseDto> {
    const cacheKey = this.buildCacheKey(profileId);
    
    // 1. Kiểm tra Redis
    try {
      if (this.redis.isEnabled()) {
        const cached = await this.redis.get<ProfileRecommendationResponseDto>(cacheKey);
        if (cached && Array.isArray(cached.packages) && cached.packages.length > 0) {
          return { ...cached, source: 'REDIS_CACHE' };
        }
      }
    } catch (err: any) {
      this.logger.warn(`Redis get failed for key ${cacheKey}: ${err?.message}`);
    }

    // 2. Cache miss -> Phân tích và lưu cache
    return this.analyzeAndCacheRecommendations(profileId);
  }

  /**
   * Kích hoạt xử lý ngầm (Non-blocking / Background qua RabbitMQ Outbox).
   * Dùng khi tạo hoặc sửa hồ sơ bệnh nhân, không làm chậm response của user.
   */
  triggerAsyncRecommendation(profileId: string, branchId?: string): void {
    void this.enqueueRecommendationTask(profileId, branchId);
  }

  private async enqueueRecommendationTask(profileId: string, branchId?: string): Promise<void> {
    try {
      await this.prisma.outboxEvent.create({
        data: {
          aggregateType: 'PatientProfile',
          aggregateId: profileId,
          eventType: 'recommendation.profile.analyze',
          payload: { profileId, branchId: branchId || null },
        },
      });
      this.logger.log(`Enqueued recommendation task [recommendation.profile.analyze] for profile ${profileId}`);
    } catch (err: any) {
      this.logger.warn(`Failed to create outbox event for profile ${profileId}, falling back to setImmediate: ${err?.message}`);
      setImmediate(() => {
        this.analyzeAndCacheRecommendations(profileId, branchId).catch((fallbackErr) => {
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

    // 4. KIỂM TRA LỊCH SỬ THĂM KHÁM (Deterministic Rule cho Gói Tái Khám)
    // - Không cần dùng AI: Nếu bệnh nhân đã hoàn tất (COMPLETED) khám chuyên khoa X trước đó,
    //   tự động kích hoạt chính xác gói "Tái khám [Chuyên khoa X]" đưa lên vị trí ưu tiên #1.
    const pastAppointments = await this.prisma.appointment.findMany({
      where: {
        patientProfileId: profileId,
        status: { in: ['COMPLETED', 'BOOKED', 'CHECKED_IN'] },
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
        }
      }
    }

    // TẦNG 2: LỌC DANH SÁCH ỨNG VIÊN ĐƯA CHO AI (Chỉ gồm gói Tầm soát / Khám ban đầu)
    // Tuyệt đối loại bỏ các gói tái khám khỏi AI để tránh việc AI gợi ý gói tái khám cho người chưa từng khám
    const screeningCandidates = allActivePackages.filter((pkg) => {
      const isFollowUpPkg = pkg.code.endsWith('-FOLLOWUP') || pkg.name.toLowerCase().includes('tái khám');
      if (isFollowUpPkg) return false;
      if (usedPackageIds.has(pkg.id)) return false;
      if (suppressedPackageIds.has(pkg.id)) return false;
      return true;
    });

    // Phân tích tầm soát bằng Gemini AI (hoặc Heuristic Rule) - không giới hạn số gói
    const targetCount = screeningCandidates.length; // Cho AI xem và chọn toàn bộ gói phù hợp
    let aiRecommendedList: RecommendedPackageItemDto[] = [];
    let source: 'AI_GEMINI' | 'RULE_FALLBACK' = 'RULE_FALLBACK';

    if (this.aiClient && screeningCandidates.length > 0) {
      try {
        aiRecommendedList = await this.evaluateWithGemini({
          profile: {
            fullName: profile.fullName,
            age,
            gender,
            bmi,
            medicalHistory,
            allergies,
          },
          targetCount,
          candidates: screeningCandidates.map((p) => ({
            id: p.id,
            name: p.name,
            code: p.code,
            description: p.description || '',
            price: Number(p.price),
            specialtyName: p.specialty?.name || 'Đa khoa',
            specialtyId: p.specialtyId,
            durationMin: p.durationMin,
          })),
        });
        if (aiRecommendedList.length > 0) {
          source = 'AI_GEMINI';
        }
      } catch (err: any) {
        this.logger.warn(`Gemini evaluation failed, falling back to clinical rules: ${err?.message}`);
      }
    }

    if (aiRecommendedList.length === 0 && screeningCandidates.length > 0) {
      aiRecommendedList = this.evaluateWithClinicalHeuristics({
        age,
        gender,
        bmi,
        medicalHistory,
        candidates: screeningCandidates,
      });
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
            `Cached AI recommendation for profile ${profileId} into Redis [key: ${cacheKey}] (TTL: ${this.CACHE_TTL_SECONDS}s)`,
          );
        }
      } catch (err: any) {
        this.logger.warn(`Failed to set Redis cache: ${err?.message}`);
      }
    } else {
      this.logger.log(
        `Skipped Redis cache for profile ${profileId} because result source is RULE_FALLBACK (will retry Gemini AI on next visit)`,
      );
    }

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
    targetCount?: number;
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

    const parsed = JSON.parse(response.text || '{}');
    const selections = Array.isArray(parsed.selectedPackages) ? parsed.selectedPackages : [];

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

  private buildCacheKey(profileId: string): string {
    return `rec:profile:${profileId}`;
  }
}
