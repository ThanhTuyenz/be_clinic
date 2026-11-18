import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';

/**
 * Resolve Branch ID từ mã public, slug hoặc code.
 */
export async function resolveBranchId(
  prisma: PrismaService,
  identifier?: string | number,
): Promise<number | undefined> {
  if (!identifier) return undefined;
  if (typeof identifier === 'number') return Number.isInteger(identifier) && identifier > 0 ? identifier : undefined;
  if (/^\d+$/.test(identifier)) return Number(identifier);
  const branch = await prisma.branch.findFirst({
    where: { OR: [{ slug: identifier }, { code: identifier }], isActive: true },
    select: { id: true },
  });
  return branch?.id;
}
