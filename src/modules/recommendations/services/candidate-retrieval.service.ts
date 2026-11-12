import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import { Prisma } from '@prisma/client';
import { containsSearchPhrase } from '../../../common/utils/search-query.js';
import { EmbeddingService, mapPackageForRetrieval } from '../../../infrastructure/embedding/embedding.service.js';
import { BehaviorTelemetryService } from './behavior-telemetry.service.js';
import { CandidatePoolItem, RecommendationPackage, RECOMMENDATION_PACKAGE_INCLUDE, TELEMETRY_CONFIG } from '../constants/recommendation.constants.js';
import { ProfileHealthContext, profileEvidenceText } from '../types/profile-health.types.js';
import { isRoutineCheckupPackage } from '../types/routine-checkup.js';

const PROFILE_SELECT = {
  id: true, fullName: true, dateOfBirth: true, gender: true,
  height: true, weight: true, medicalHistory: true, allergies: true,
  familyHistory: true,
  smokingStatus: true, alcoholUse: true, activityLevel: true, pregnancyStatus: true, isBreastfeeding: true,
} satisfies Prisma.PatientProfileSelect;

const FEMALE_PACKAGE_KEYWORDS = ['phụ khoa', 'thai sản', 'cổ tử cung', 'buồng trứng', 'mang thai', 'tiền hôn nhân nữ', 'ung thư vú', 'khám thai', 'sinh sản nữ', 'nữ giới'];
const MALE_PACKAGE_KEYWORDS = ['nam khoa', 'tuyến tiền liệt', 'sinh sản nam', 'tiền hôn nhân nam', 'sức khỏe nam giới', 'nam giới'];
const PEDIATRIC_PACKAGE_KEYWORDS = ['nhi khoa', 'sơ sinh', 'trẻ em', 'tiêm chủng trẻ em'];
const ADULT_PACKAGE_KEYWORDS = ['lão khoa', 'tiền mãn kinh', 'mãn kinh', 'tuyến tiền liệt', 'tiền hôn nhân'];
const AGE_SPECIFIC_PACKAGE_KEYWORDS = [...PEDIATRIC_PACKAGE_KEYWORDS, ...ADULT_PACKAGE_KEYWORDS];

export interface ProfileRecommendationContext extends ProfileHealthContext {
  profile: Prisma.PatientProfileGetPayload<{ select: typeof PROFILE_SELECT }> | null;
  age: number | null;
  gender: string;
  bmi: number | null;
  medicalHistory: string;
  allergies: string;
  recentlyCompletedPackageIds: string[];
}

export interface BehaviorCandidate {
  pkg: RecommendationPackage;
  sourceType: 'SEARCH_INTENT' | 'DROP_OFF' | 'RECENT_VIEW';
  viewCount?: number;
  lastViewedAt?: number;
  searchQuery?: string;
  searchedAt?: number;
  abandonedAt?: number;
  searchRank?: number;
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
      familyHistory: profile.familyHistory,
      smokingStatus: profile.smokingStatus, alcoholUse: profile.alcoholUse, activityLevel: profile.activityLevel,
      pregnancyStatus: profile.pregnancyStatus, isBreastfeeding: profile.isBreastfeeding,
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
    const limit = TELEMETRY_CONFIG.CANDIDATE_POOL_TARGET;
    const added = new Set<string>();
    const add = (pkg: RecommendationPackage, score?: number) => {
      if (added.has(pkg.id) || candidates.length >= limit) return;
      added.add(pkg.id);
      candidates.push({ pkg, origin: 'PROFILE', retrievalScore: score,
        evidenceSignals: [pkg.specialty?.name, ...(pkg.symptoms || [])].filter((value): value is string =>
          Boolean(value && value.length >= 3 && containsSearchPhrase(profileEvidenceText(context), value))),
      });
    };
    // Preserve a few general checkups rather than letting vector similarity exclude them.
    if (context.age != null && context.age >= 18 && context.pregnancyStatus !== 'PREGNANT') {
      eligible.filter(isRoutineCheckupPackage).slice(0, 4).forEach(pkg => add(pkg));
    }
    const text = this.embeddingService.buildPatientEmbeddingText({
      age: context.age, gender: context.gender, bmi: context.bmi,
      medicalHistory: context.medicalHistory, allergies: context.allergies,
      familyHistory: context.familyHistory,
    });
    const matches = await this.embeddingService.retrieveTopPackages(text, eligible.map(mapPackageForRetrieval),
      TELEMETRY_CONFIG.CANDIDATE_POOL_TARGET);
    for (const match of matches) {
      const pkg = eligible.find(item => item.id === match.package.id);
      if (pkg) add(pkg, match.score);
    }
    return candidates;
  }

  // Hành vi không phụ thuộc hồ sơ đang chọn.
  async getBehaviorCandidates(
    userId?: string,
    sessionId?: string,
    preloadedPackages?: RecommendationPackage[],
    telemetry?: Awaited<ReturnType<BehaviorTelemetryService['getBehaviorTelemetryContext']>>,
  ): Promise<{ candidates: BehaviorCandidate[] }> {
    const context = telemetry ?? await this.behaviorTelemetryService.getBehaviorTelemetryContext(userId, sessionId);
    const allPackages = preloadedPackages ?? await this.loadActivePackages();
    const catalogById = new Map(allPackages.map(pkg => [pkg.id, pkg]));
    
    const candidates: BehaviorCandidate[] = [];
    const add = (id: string, signal: Omit<BehaviorCandidate, 'pkg'>) => {
      const pkg = catalogById.get(id);
      if (pkg) candidates.push({ pkg, ...signal });
    };
    for (const drop of context.recentDropOffs) {
      add(drop.packageId, { sourceType: 'DROP_OFF', abandonedAt: drop.abandonedAt });
    }
    for (const view of context.recentViews) {
      add(view.packageId, { sourceType: 'RECENT_VIEW', viewCount: view.viewCount, lastViewedAt: view.lastViewedAt });
    }
    for (const search of context.recentSearches) {
      // Legacy query-only history cannot prove which packages were returned.
      for (const [rank, id] of (search.packageIds || []).entries()) {
        add(id, { sourceType: 'SEARCH_INTENT', searchQuery: search.query,
          searchedAt: search.searchedAt, searchRank: rank });
      }
    }
    return { candidates };
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

  // Kiểm tra điều kiện cấu hình và từ khóa tuổi/giới tính của gói.
  isPackageEligibleForProfile(pkg: RecommendationPackage, context: Pick<ProfileRecommendationContext, 'profile' | 'age' | 'gender'>): boolean {
    if (!context?.profile) return true;
    const { age } = context;
    const targetGender = String(pkg.targetGender || 'ALL').toUpperCase();
    const gender = String(context.gender || 'OTHER').toUpperCase();
    if (targetGender !== 'ALL' && targetGender !== gender) return false;
    if (typeof pkg.minAge === 'number' && (age === null || age < pkg.minAge)) return false;
    if (typeof pkg.maxAge === 'number' && (age === null || age > pkg.maxAge)) return false;
    if (pkg.isPediatric === true && (age === null || age >= 18)) return false;

    const text = `${pkg.name} ${pkg.description || ''}`.toLowerCase();
    const genderKeywords = gender === 'MALE' ? FEMALE_PACKAGE_KEYWORDS : gender === 'FEMALE' ? MALE_PACKAGE_KEYWORDS : [];
    const ageKeywords = age === null ? AGE_SPECIFIC_PACKAGE_KEYWORDS : age >= 18 ? PEDIATRIC_PACKAGE_KEYWORDS : ADULT_PACKAGE_KEYWORDS;
    return !genderKeywords.some(keyword => text.includes(keyword))
      && !ageKeywords.some(keyword => text.includes(keyword));
  }

}
