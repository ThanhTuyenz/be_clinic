import { Prisma, PackageSession } from '@prisma/client';

// Keep source IDs stable: existing slots and appointments retain their parent.
// Caller owns the transaction; the package lock serializes schedule edits.
export async function replaceReceptionSchedules(
  tx: Prisma.TransactionClient,
  servicePackageId: number,
  branchIds: number[],
  days: { branchId: number; dayOfWeek: number; sessions: readonly string[] }[],
) {
  await tx.$queryRaw`SELECT id FROM service_packages WHERE id = ${servicePackageId} FOR UPDATE`;
  await tx.packageReceptionTime.updateMany({
    where: { servicePackageId, branchId: { in: branchIds } }, data: { isActive: false },
  });
  for (const day of days) {
    const sessions = [...day.sessions] as PackageSession[];
    await tx.packageReceptionTime.upsert({
      where: { servicePackageId_branchId_dayOfWeek: { servicePackageId, branchId: day.branchId, dayOfWeek: day.dayOfWeek } },
      update: { sessions, isActive: true },
      create: { servicePackageId, branchId: day.branchId, dayOfWeek: day.dayOfWeek, sessions },
    });
  }
}
