import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import { Prisma } from '@prisma/client';
import { containsSearchPhrase } from '../../../common/utils/search-query.js';
import { EmbeddingService, mapPackageForRetrieval, PackageForRetrieval } from '../../../infrastructure/embedding/embedding.service.js';
import { BehaviorTelemetryService } from './behavior-telemetry.service.js';
import { CandidatePoolItem, RecommendationPackage, RECOMMENDATION_PACKAGE_INCLUDE, TELEMETRY_CONFIG } from '../constants/recommendation.constants.js';

const PROFILE_SELECT = {
  id: true, fullName: true, dateOfBirth: true, gender: true,
  height: true, weight: true, medicalHistory: true, allergies: true,
} satisfies Prisma.PatientProfileSelect;

export interface ProfileRecommendationContext {
  profile: Prisma.PatientProfileGetPayload<{ select: typeof PROFILE_SELECT }> | null;
  age: number | null;
  gender: string;
  bmi: number | null;
  medicalHistory: string;
  allergies: string;
  recentlyCompletedPackageIds: string[];
}

@Injectable()
export class CandidateRetrievalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: EmbeddingService,
    private readonly behaviorTelemetryService: BehaviorTelemetryService,
  ) { }

  async getProfileContext(profileId?: string): Promise<ProfileRecommendationContext> {
    const empty: ProfileRecommendationContext = {
      profile: null, age: null, gender: 'OTHER', bmi: null, medicalHistory: '', allergies: '',
      recentlyCompletedPackageIds: [],
    };
    if (!profileId) return empty;
    const profile = await this.prisma.patientProfile.findUnique({ where: { id: profileId }, select: PROFILE_SELECT });
    if (!profile) return empty;
    const dob = profile.dateOfBirth;
    const age = dob ? Math.abs(new Date(Date.now() - dob.getTime()).getUTCFullYear() - 1970) : null;
    const height = Number(profile.height || 0), weight = Number(profile.weight || 0);
    const history = await this.prisma.appointment.findMany({
      where: { patientProfileId: profileId, status: 'COMPLETED' },
      select: { servicePackageId: true, createdAt: true },
      orderBy: { createdAt: 'desc' }, take: 20,
    });
    return {
      profile, age, gender: profile.gender || 'OTHER',
      bmi: height > 50 && weight > 10 ? +(weight / ((height / 100) ** 2)).toFixed(1) : null,
      medicalHistory: (profile.medicalHistory || '').trim(), allergies: (profile.allergies || '').trim(),
      recentlyCompletedPackageIds: [...new Set(history
        .filter(item => Date.now() - item.createdAt.getTime() <= TELEMETRY_CONFIG.RECENCY_SUPPRESSION_DAYS * 86400000)
        .map(item => item.servicePackageId).filter((id): id is string => Boolean(id)))],
    };
  }

  async getProfileCandidates(context: ProfileRecommendationContext, packages: RecommendationPackage[]): Promise<CandidatePoolItem[]> {
    if (!context.profile) return [];
    const eligible = packages.filter(pkg => this.isPackageEligibleForProfile(pkg, context)
      && !context.recentlyCompletedPackageIds.includes(pkg.id));
    const candidates: CandidatePoolItem[] = [];
    const text = this.embeddingService.buildPatientEmbeddingText({
      age: context.age, gender: context.gender, bmi: context.bmi,
      medicalHistory: context.medicalHistory, allergies: context.allergies,
    });
    const matches = await this.embeddingService.retrieveTopPackages(text, eligible.map(mapPackageForRetrieval),
      TELEMETRY_CONFIG.CANDIDATE_POOL_TARGET);
    for (const match of matches) {
      const pkg = eligible.find(item => item.id === match.package.id);
      if (pkg && !candidates.some(item => item.pkg.id === pkg.id)) candidates.push({ pkg, origin: 'PROFILE',
        retrievalScore: match.score,
        evidenceSignals: [pkg.specialty?.name, ...(pkg.symptoms || [])].filter((value): value is string =>
          Boolean(value && value.length >= 3 && containsSearchPhrase(context.medicalHistory, value))),
      });
    }
    return candidates;
  }

  // Hành vi không phụ thuộc hồ sơ đang chọn.
  async getBehaviorCandidates(
    userId?: string,
    sessionId?: string,
    preloadedPackages?: RecommendationPackage[],
    telemetry?: Awaited<ReturnType<BehaviorTelemetryService['getBehaviorTelemetryContext']>>,
  ): Promise<{
    candidates: Array<{ pkg: RecommendationPackage; sourceType: 'SEARCH_INTENT' | 'DROP_OFF' | 'RECENT_VIEW' | 'SPECIALTY_INTEREST'; viewCount?: number; lastViewedAt?: number; searchQuery?: string }>;
  }> {
    const context = telemetry ?? await this.behaviorTelemetryService.getBehaviorTelemetryContext(userId, sessionId);
    const candidates: Array<{ pkg: RecommendationPackage; sourceType: 'SEARCH_INTENT' | 'DROP_OFF' | 'RECENT_VIEW' | 'SPECIALTY_INTEREST'; viewCount?: number; lastViewedAt?: number; searchQuery?: string }> = [];
    const addedPackageIds = new Set<string>();

    const allPackages = preloadedPackages ?? await this.loadActivePackages();

    // 1. Ưu tiên gói bỏ dở
    if (context.dropOffPkgId) {
      const dropOffMatch = allPackages.find((p) => p.id === context.dropOffPkgId);
      if (dropOffMatch) {
        candidates.push({ pkg: dropOffMatch, sourceType: 'DROP_OFF' });
        addedPackageIds.add(dropOffMatch.id);
      }
    }

    // Reserve candidate space for actual views before semantic search can fill
    // the pool. With both signals, views use at most half the candidate budget.
    const catalogById = new Map(allPackages.map(pkg => [pkg.id, pkg]));
    const viewWeight = (view: { viewCount: number; lastViewedAt: number }) =>
      Math.log1p(view.viewCount) / (1 + Math.max(0, Date.now() - view.lastViewedAt) / 86400000);
    const viewLimit = context.lastSearchQuery
      ? Math.ceil(TELEMETRY_CONFIG.CANDIDATE_POOL_TARGET / 2) : TELEMETRY_CONFIG.CANDIDATE_POOL_TARGET;
    const views = [...(context.recentViews || [])].filter(view => catalogById.has(view.packageId))
      .sort((a, b) => viewWeight(b) - viewWeight(a) || b.lastViewedAt - a.lastViewedAt || a.packageId.localeCompare(b.packageId))
      .slice(0, viewLimit);
    for (const view of views) {
      const pkg = catalogById.get(view.packageId)!;
      if (!addedPackageIds.has(pkg.id)) {
        candidates.push({ pkg, sourceType: 'RECENT_VIEW', viewCount: view.viewCount, lastViewedAt: view.lastViewedAt });
        addedPackageIds.add(pkg.id);
      }
    }

    // Tìm kiếm ngữ nghĩa theo từ khóa tìm kiếm gần nhất.
    if (context.lastSearchQuery && context.lastSearchQuery.length >= 2) {
      const candidateObjects: PackageForRetrieval[] = allPackages.map(mapPackageForRetrieval);
      const searchMatches = await this.embeddingService.searchByNaturalLanguage(
        context.lastSearchQuery,
        candidateObjects,
        TELEMETRY_CONFIG.SEMANTIC_SEARCH_LIMIT,
      );

      for (const sm of searchMatches) {
        if (!addedPackageIds.has(sm.package.id)) {
          const matchPkg = allPackages.find((p) => p.id === sm.package.id);
          if (matchPkg) {
            candidates.push({ pkg: matchPkg, sourceType: 'SEARCH_INTENT', searchQuery: context.lastSearchQuery });
            addedPackageIds.add(matchPkg.id);
          }
        }
      }
    }

    // 3. Related alternatives are never labelled as packages the user viewed.
    const qualifiedSpecialties = context.topSpecialties
      .filter((s) => s.score >= TELEMETRY_CONFIG.MIN_QUALIFIED_SCORE)
      .slice(0, TELEMETRY_CONFIG.MAX_TOP_SPECIALTIES);

    for (const spec of qualifiedSpecialties) {
      const specPackages = allPackages
        .filter((p) => p.specialtyId === spec.specialtyId && !addedPackageIds.has(p.id))
        .slice(0, TELEMETRY_CONFIG.MAX_PACKAGES_PER_SPECIALTY);

      for (const p of specPackages) {
        candidates.push({ pkg: p, sourceType: 'SPECIALTY_INTEREST' });
        addedPackageIds.add(p.id);
      }
    }

    return {
      candidates: candidates.slice(0, TELEMETRY_CONFIG.CANDIDATE_POOL_TARGET),
    };
  }

  // load toàn bộ gói
  async loadActivePackages(): Promise<RecommendationPackage[]> {
    return this.prisma.servicePackage.findMany({
      where: {
        isActive: true,
        OR: [
          { branchBookingMethod: { isEnabled: true, branch: { isActive: true }, bookingMethod: { isActive: true } } },
          { branchBookingMethods: { some: { branchBookingMethod: { isEnabled: true, branch: { isActive: true }, bookingMethod: { isActive: true } } } } },
        ],
      },
      include: RECOMMENDATION_PACKAGE_INCLUDE,
      orderBy: [{ price: 'asc' }, { id: 'asc' }],
    });
  }

  // kiểm tra gói phù hợp với 
  isPackageEligibleForProfile(pkg: RecommendationPackage, profileTower: Pick<ProfileRecommendationContext, 'profile' | 'age' | 'gender'>): boolean {
    if (!profileTower?.profile) return true;
    const targetGender = String(pkg.targetGender || 'ALL').toUpperCase();
    const gender = String(profileTower.gender || 'OTHER').toUpperCase();
    if (targetGender !== 'ALL' && targetGender !== gender) return false;
    if (typeof pkg.minAge === 'number' && (profileTower.age === null || profileTower.age < pkg.minAge)) return false;
    if (typeof pkg.maxAge === 'number' && (profileTower.age === null || profileTower.age > pkg.maxAge)) return false;
    if (pkg.isPediatric === true && (profileTower.age === null || profileTower.age >= 18)) return false;
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

  isPackageAppropriateForAge(name: string, description: string, age: number | null): boolean {
    const text = `${name} ${description}`.toLowerCase();
    if (age === null) return !['nhi khoa', 'sơ sinh', 'trẻ em', 'lão khoa', 'tiền mãn kinh', 'mãn kinh', 'tuyến tiền liệt', 'tiền hôn nhân'].some(keyword => text.includes(keyword));
    if (age >= 18) {
      const pediatricsKeywords = ['nhi khoa', 'sơ sinh', 'trẻ em', 'tiêm chủng trẻ em'];
      if (pediatricsKeywords.some((kw) => text.includes(kw))) return false;
    } else if (age < 18) {
      const adultKeywords = ['lão khoa', 'tiền mãn kinh', 'mãn kinh', 'tuyến tiền liệt', 'tiền hôn nhân'];
      if (adultKeywords.some((kw) => text.includes(kw))) return false;
    }
    return true;
  }

}
