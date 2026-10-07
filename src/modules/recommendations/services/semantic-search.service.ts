import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import { RedisService } from '../../../infrastructure/redis/redis.service.js';
import { EmbeddingService, PackageForRetrieval } from '../../../infrastructure/embedding/embedding.service.js';

@Injectable()
export class SemanticSearchService {
  private readonly logger = new Logger(SemanticSearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly embeddingService: EmbeddingService,
  ) { }

  // Tìm kiếm tự nhiên bằng Vector Embeddings & Keyword Search
  async semanticSearchPackages(query: string, branchId?: string) {
    if (!query || !query.trim()) return { query: '', total: 0, packages: [], doctors: [], branches: [] };
    const q = query.trim();

    const [packages, matchedDoctors, matchedBranches] = await Promise.all([
      (async () => {
        const pkgs = await this.prisma.servicePackage.findMany({
          where: {
            isActive: true,
            ...(branchId ? { branchBookingMethod: { branchId, isEnabled: true } } : {}),
          },
          include: { specialty: { select: { id: true, name: true, symptoms: true, description: true } } },
          orderBy: { price: 'asc' },
        });

        const mapped: PackageForRetrieval[] = pkgs.map((p) => {
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
        });

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

      this.prisma.branch.findMany({
        where: {
          isActive: true,
          OR: [{ name: { contains: q, mode: 'insensitive' } }, { address: { contains: q, mode: 'insensitive' } }],
        },
        take: 3,
        select: { id: true, code: true, name: true, address: true, phoneNumber: true },
      }),
    ]);

    const finalResult = {
      query: q,
      total: packages.length + matchedDoctors.length + matchedBranches.length,
      packages,
      doctors: matchedDoctors.map((doc) => ({
        id: doc.id,
        fullName: doc.user?.fullName || 'Bác sĩ',
        academicRank: doc.academicRank || 'Bác sĩ',
        specialties: doc.specialties.map((s) => s.specialty?.name).filter(Boolean) as string[],
        experienceYears: doc.experienceYears || 0,
        avatarUrl: doc.avatarUrl || null,
        ratingAverage: doc.ratingAverage || 5.0,
      })),
      branches: matchedBranches,
    };

    // Telemetry: Lưu từ khóa và cờ hasResults vào Redis & DB
    try {
      if (q.length >= 2) {
        const normalizedQ = q.toLowerCase();
        const hasResults = packages.length > 0;
        const client = this.redis.getClient();
        if (client) {
          if (hasResults) {
            await client.zincrby('rec:global:search_queries', 1, normalizedQ);
          } else {
            await client.zincrby('rec:global:unmatched_queries', 1, normalizedQ);
          }
        }

        const dateKey = new Date().toISOString().slice(0, 10);
        await this.prisma.searchLog.upsert({
          where: {
            keyword_dateKey_hasResults: {
              keyword: normalizedQ,
              dateKey,
              hasResults,
            },
          },
          update: { count: { increment: 1 } },
          create: {
            keyword: normalizedQ,
            dateKey,
            count: 1,
            hasResults,
          },
        }).catch(() => { });
      }
    } catch (err: any) {
      this.logger.debug(`[SemanticSearch] Failed to log telemetry: ${err?.message}`);
    }

    return finalResult;
  }
}
