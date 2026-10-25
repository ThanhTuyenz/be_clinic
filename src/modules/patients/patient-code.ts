import { Prisma } from '@prisma/client';

export async function resolvePatientCode(tx: Prisma.TransactionClient, nationalId?: string | null, healthInsuranceNumber?: string | null) {
  const prefix = `BN${String(new Date().getFullYear()).slice(-2)}`;
  // Serialize code allocation across online registration and reception transactions.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${prefix}))`;
  if (nationalId || healthInsuranceNumber) {
    const existing = await tx.patientProfile.findFirst({
      where: {
        OR: [
          ...(nationalId ? [{ nationalId }] : []),
          ...(healthInsuranceNumber ? [{ healthInsuranceNumber }] : []),
        ],
        patientCode: { not: null },
      },
      select: { patientCode: true },
    });
    if (existing?.patientCode) return existing.patientCode;
  }
  const last = await tx.patientProfile.findFirst({
    where: { patientCode: { startsWith: prefix } },
    orderBy: { patientCode: 'desc' },
    select: { patientCode: true },
  });
  const previous = Number.parseInt(last?.patientCode?.slice(prefix.length) || '0', 10);
  return `${prefix}${String((Number.isFinite(previous) ? previous : 0) + 1).padStart(5, '0')}`;
}
