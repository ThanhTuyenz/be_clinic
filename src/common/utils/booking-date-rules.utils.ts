import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';

/**
 * Resolve Branch ID từ chuỗi UUID, slug hoặc code
 */
export async function resolveBranchId(
  prisma: PrismaService,
  identifier?: string,
): Promise<string | undefined> {
  if (!identifier) return undefined;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier)) {
    return identifier;
  }
  const branch = await prisma.branch.findFirst({
    where: { OR: [{ slug: identifier }, { code: identifier }], isActive: true },
    select: { id: true },
  });
  return branch?.id ?? identifier;
}
