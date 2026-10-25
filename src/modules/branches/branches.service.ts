import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { isUuid } from '../../common/utils/staff.utils.js';

@Injectable()
export class BranchesService {
  constructor(private readonly prisma: PrismaService) {}



  async resolveBranchId(identifier?: string): Promise<string | undefined> {
    if (!identifier) return undefined;
    if (isUuid(identifier)) return identifier;
    const branch = await this.prisma.branch.findFirst({
      where: { OR: [{ slug: identifier }, { code: identifier }], isActive: true },
      select: { id: true },
    });
    return branch?.id ?? identifier;
  }

  branches() {
    return this.prisma.branch.findMany({
      where: { isActive: true },
      orderBy: [
        { code: 'desc' },
        { name: 'asc' },
      ],
      select: {
        id: true,
        code: true,
        slug: true,
        name: true,
        address: true,
        latitude: true,
        longitude: true,
        phoneNumber: true,
        timezone: true,
      },
    });
  }

  departments(branchId: string) {
    return this.prisma.specialty.findMany({
      where: { branches: { some: { branchId, isActive: true } } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true, description: true },
    });
  }
}
