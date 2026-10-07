import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import { RedisService } from '../../../infrastructure/redis/redis.service.js';
import { EmbeddingService, PackageForRetrieval } from '../../../infrastructure/embedding/embedding.service.js';
import { BehaviorTelemetryService } from './behavior-telemetry.service.js';
import { ProfileRecommendationResponseDto } from '../recommendation.dto.js';
import { CandidatePoolItem, TELEMETRY_CONFIG } from '../constants/recommendation.constants.js';

@Injectable()
export class CandidateRetrievalService {
  private readonly logger = new Logger(CandidateRetrievalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly embeddingService: EmbeddingService,
    private readonly behaviorTelemetryService: BehaviorTelemetryService,
  ) { }

  //   ứng viên theo hồ sơ
  async getProfileCandidates(
    profileId?: string,
    branchId?: string,
    preloadedPackages?: any[],
    skipCache = false,
  ): Promise<{
    profile: any;
    age: number;
    gender: string;
    bmi: number | null;
    medicalHistory: string;
    allergies: string;
    candidates: Array<{ pkg: any; isFollowUp?: boolean }>;
  }> {
    const emptyResult = {
      profile: null,
      age: 30,
      gender: 'OTHER',
      bmi: null,
      medicalHistory: '',
      allergies: '',
      candidates: [],
    };

    if (!profileId) return emptyResult;

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

    if (!profile) return emptyResult;

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

    // 1. Kiểm tra lịch sử tái khám
    const pastAppointments = await this.prisma.appointment.findMany({
      where: {
        patientProfileId: profileId,
        status: 'COMPLETED',
      },
      include: {
        servicePackage: { select: { id: true, name: true, code: true, specialtyId: true, specialty: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 3,
    });

    const candidates: Array<{ pkg: any; isFollowUp?: boolean }> = [];

    // Tái dùng danh sách gói đã load sẵn (tránh query N+1 khi gọi từ Orchestrator)
    const allPackages = preloadedPackages ?? await this.loadActivePackages(branchId);

    if (pastAppointments.length > 0) {
      const latest = pastAppointments[0];
      const specId = latest.servicePackage?.specialtyId;
      if (specId) {
        const followUpPkg = allPackages.find(
          (p) => p.specialtyId === specId && (p.code.endsWith('-FOLLOWUP') || p.name.toLowerCase().includes('tái khám')),
        );
        if (followUpPkg) {
          candidates.push({ pkg: followUpPkg, isFollowUp: true });
        }
      }
    }

    // 2. Kiểm tra Cache Profile 7 ngày (tránh chạy Vector Similarity Search tốn kém nếu hồ sơ đã có kết quả AI)
    if (!skipCache && this.redis.isEnabled()) {
      try {
        const cachedProfileRec = await this.redis.get<ProfileRecommendationResponseDto>(this.buildCacheKey(profileId));
        if (cachedProfileRec && Array.isArray(cachedProfileRec.packages) && cachedProfileRec.packages.length > 0) {
          for (const cachedPkg of cachedProfileRec.packages) {
            const match = allPackages.find((p) => p.id === cachedPkg.packageId);
            if (match && !candidates.some((item) => item.pkg.id === match.id)) {
              candidates.push({ pkg: match, isFollowUp: cachedPkg.badge?.includes('Tái khám') });
            }
          }
        }
      } catch (err: any) {
        this.logger.debug(`[ProfileRec] Failed to read profile cache: ${err?.message}`);
      }
    }

    // 3. Nếu chưa đủ ứng viên từ cache (hoặc cache miss), chạy Vector Similarity Search
    if (candidates.length < 6) {
      // Lọc độ tuổi & giới tính
      const validScreening = allPackages.filter((pkg) => {
        if (pkg.code.endsWith('-FOLLOWUP') || pkg.name.toLowerCase().includes('tái khám')) return false;
        if (!this.isPackageAppropriateForGender(pkg.name, pkg.description || '', gender)) return false;
        if (!this.isPackageAppropriateForAge(pkg.name, pkg.description || '', age)) return false;
        return true;
      });

      const patientEmbeddingText = this.embeddingService.buildPatientEmbeddingText({
        fullName: profile.fullName,
        age,
        gender,
        bmi,
        medicalHistory,
        allergies,
      });

      const candidateObjects: PackageForRetrieval[] = validScreening.map((p) => this.mapToRetrievalPackage(p));

      const topRetrieved = await this.embeddingService.retrieveTopPackages(patientEmbeddingText, candidateObjects, 8);
      for (const r of topRetrieved) {
        const match = allPackages.find((p) => p.id === r.package.id);
        if (match && !candidates.some((item) => item.pkg.id === match.id)) {
          candidates.push({ pkg: match });
        }
      }
    }

    return {
      profile,
      age,
      gender,
      bmi,
      medicalHistory,
      allergies,
      candidates,
    };
  }

  // ứng viên theo profile
  async getBehaviorCandidates(
    userId?: string,
    sessionId?: string,
    branchId?: string,
    preloadedPackages?: any[],
  ): Promise<{
    topSpecialties: Array<{ specialtyId: number; specialtyName: string; score: number }>;
    lastSearchQuery?: string;
    dropOffPkgId?: string;
    candidates: Array<{ pkg: any; sourceType: 'SEARCH_INTENT' | 'DROP_OFF' | 'RECENT_VIEW' }>;
  }> {
    const context = await this.behaviorTelemetryService.getBehaviorTelemetryContext(userId, sessionId);
    const candidates: Array<{ pkg: any; sourceType: 'SEARCH_INTENT' | 'DROP_OFF' | 'RECENT_VIEW' }> = [];
    const addedPackageIds = new Set<string>();

    const allPackages = preloadedPackages ?? await this.loadActivePackages(branchId);

    // 1. Ưu tiên gói bỏ dở
    if (context.dropOffPkgId) {
      const dropOffMatch = allPackages.find((p) => p.id === context.dropOffPkgId);
      if (dropOffMatch) {
        candidates.push({ pkg: dropOffMatch, sourceType: 'DROP_OFF' });
        addedPackageIds.add(dropOffMatch.id);
      }
    }

    // 2. Tìm kiếm ngữ nghĩa theo từ khóa tìm kiếm gần nhất
    if (context.lastSearchQuery && context.lastSearchQuery.length >= 2) {
      const candidateObjects: PackageForRetrieval[] = allPackages.map((p) => this.mapToRetrievalPackage(p));
      const searchMatches = await this.embeddingService.searchByNaturalLanguage(
        context.lastSearchQuery,
        candidateObjects,
        TELEMETRY_CONFIG.SEMANTIC_SEARCH_LIMIT,
      );

      for (const sm of searchMatches) {
        if (!addedPackageIds.has(sm.package.id)) {
          const matchPkg = allPackages.find((p) => p.id === sm.package.id);
          if (matchPkg) {
            candidates.push({ pkg: matchPkg, sourceType: 'SEARCH_INTENT' });
            addedPackageIds.add(matchPkg.id);
          }
        }
      }
    }

    // 3. Trích xuất gói từ các chuyên khoa có điểm quan tâm cao
    const qualifiedSpecialties = context.topSpecialties
      .filter((s) => s.score >= TELEMETRY_CONFIG.MIN_QUALIFIED_SCORE)
      .slice(0, TELEMETRY_CONFIG.MAX_TOP_SPECIALTIES);

    for (const spec of qualifiedSpecialties) {
      const specPackages = allPackages
        .filter((p) => p.specialtyId === spec.specialtyId && !addedPackageIds.has(p.id))
        .slice(0, TELEMETRY_CONFIG.MAX_PACKAGES_PER_SPECIALTY);

      for (const p of specPackages) {
        candidates.push({ pkg: p, sourceType: 'RECENT_VIEW' });
        addedPackageIds.add(p.id);
      }
    }

    return {
      topSpecialties: context.topSpecialties,
      lastSearchQuery: context.lastSearchQuery,
      dropOffPkgId: context.dropOffPkgId,
      candidates: candidates.slice(0, TELEMETRY_CONFIG.CANDIDATE_POOL_TARGET),
    };
  }

  // list ứng viên hoàn chỉnh
  buildHomeCandidatePool(
    profileTower: any,
    behaviorTower: any,
    allActivePackages: any[],
  ): CandidatePoolItem[] {
    const candidatePoolMap = new Map<string, CandidatePoolItem>();

    for (const item of profileTower.candidates) {
      candidatePoolMap.set(item.pkg.id, {
        pkg: item.pkg,
        origin: 'PROFILE',
        isFollowUp: item.isFollowUp,
      });
    }

    for (const beh of behaviorTower.candidates) {
      if (candidatePoolMap.has(beh.pkg.id)) {
        const existing = candidatePoolMap.get(beh.pkg.id)!;
        existing.origin = 'BOTH';
        existing.behaviorSourceType = beh.sourceType;
      } else {
        if (!this.isPackageEligibleForProfile(beh.pkg, profileTower)) continue;
        candidatePoolMap.set(beh.pkg.id, {
          pkg: beh.pkg,
          origin: 'BEHAVIOR',
          behaviorSourceType: beh.sourceType,
        });
      }
    }

    // 3. Bổ sung nếu chưa đủ ngưỡng tối thiểu
    if (candidatePoolMap.size < TELEMETRY_CONFIG.HOME_CANDIDATE_POOL_MIN) {
      for (const p of allActivePackages) {
        if (!candidatePoolMap.has(p.id)) {
          if (!this.isPackageEligibleForProfile(p, profileTower)) continue;
          candidatePoolMap.set(p.id, { pkg: p, origin: 'POPULAR' });
          if (candidatePoolMap.size >= TELEMETRY_CONFIG.HOME_CANDIDATE_POOL_MAX) break;
        }
      }
    }

    return Array.from(candidatePoolMap.values());
  }

  // load toàn bộ gói
  async loadActivePackages(branchId?: string): Promise<any[]> {
    return this.prisma.servicePackage.findMany({
      where: {
        isActive: true,
        ...(branchId ? { branchBookingMethod: { branchId, isEnabled: true } } : {}),
      },
      include: { specialty: { select: { id: true, name: true, slug: true } } },
      orderBy: { price: 'asc' },
    });
  }

  // kiểm tra gói phù hợp với 
  isPackageEligibleForProfile(pkg: any, profileTower: any): boolean {
    if (!profileTower?.profile) return true;
    if (!this.isPackageAppropriateForGender(pkg.name, pkg.description || '', profileTower.gender)) return false;
    if (!this.isPackageAppropriateForAge(pkg.name, pkg.description || '', profileTower.age)) return false;
    return true;
  }

  isPackageAppropriateForGender(name: string, description: string, gender: string): boolean {
    const text = `${name} ${description}`.toLowerCase();
    const g = (gender || '').toUpperCase();
    if (g === 'MALE') {
      const femaleKeywords = ['phụ khoa', 'thai sản', 'cổ tử cung', 'buồng trứng', 'mang thai', 'tiền hôn nhân nữ', 'ung thư vú', 'khám thai', 'sinh sản nữ', 'nữ giới'];
      if (femaleKeywords.some((kw) => text.includes(kw))) return false;
    } else if (g === 'FEMALE') {
      const maleKeywords = ['nam khoa', 'tuyến tiền liệt', 'sinh sản nam', 'tiền hôn nhân nam', 'sức khỏe nam giới', 'nam giới'];
      if (maleKeywords.some((kw) => text.includes(kw))) return false;
    }
    return true;
  }

  isPackageAppropriateForAge(name: string, description: string, age: number): boolean {
    const text = `${name} ${description}`.toLowerCase();
    if (age >= 18) {
      const pediatricsKeywords = ['nhi khoa', 'sơ sinh', 'trẻ em', 'tiêm chủng trẻ em'];
      if (pediatricsKeywords.some((kw) => text.includes(kw))) return false;
    } else if (age < 16) {
      const adultKeywords = ['lão khoa', 'tiền mãn kinh', 'mãn kinh', 'tuyến tiền liệt', 'tiền hôn nhân'];
      if (adultKeywords.some((kw) => text.includes(kw))) return false;
    }
    return true;
  }

  mapToRetrievalPackage(p: any): PackageForRetrieval {
    const combinedSymptoms = Array.from(
      new Set([...(p.symptoms || []), ...(p.specialty?.symptoms || [])]),
    );
    const fullDescription = [p.description, p.specialty?.description]
      .filter(Boolean)
      .join(' - ');
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      description: fullDescription,
      symptoms: combinedSymptoms,
      price: Number(p.price),
      durationMin: p.durationMin,
      specialtyId: p.specialtyId,
      specialtyName: p.specialty?.name || 'Đa khoa',
    };
  }

  buildCacheKey(profileId: string): string {
    return `rec:profile:${profileId}`;
  }
}
