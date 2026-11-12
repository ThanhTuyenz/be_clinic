/** Stable package identity, independent of the branch offering it. */
export function sharedPackageCode(code, branchCode) {
  const branchSuffix = branchCode.replace(/^VC-/, '');
  if (code.startsWith(`CONSULT-${branchSuffix}-`)) return code.replace(`CONSULT-${branchSuffix}-`, 'CONSULT-');
  if (code.startsWith('PKG-') && code.endsWith(`-${branchCode}`)) return code.slice(0, -branchCode.length - 1);
  return code;
}

export function sharedPackageName(name, branchName) {
  const suffix = ` (${branchName})`;
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
}

/** Seed one catalog item, then attach each offering branch without duplicating it. */
export async function upsertSharedSeedPackage(prisma, { where, update, create }) {
  const { branchBookingMethods, receptionSchedules, ...fields } = create;
  const { branchBookingMethodId: _legacyMethod, ...updatedFields } = update;
  return prisma.$transaction(async tx => {
    const pkg = await tx.servicePackage.upsert({ where, create: fields, update: updatedFields });
    const branchBookingMethodId = branchBookingMethods.create.branchBookingMethodId;
    await tx.packageBranchMethod.upsert({
      where: { servicePackageId_branchBookingMethodId: { servicePackageId: pkg.id, branchBookingMethodId } },
      create: { servicePackageId: pkg.id, branchBookingMethodId }, update: {},
    });
    for (const schedule of receptionSchedules.create) {
      await tx.packageReceptionTime.upsert({
        where: { servicePackageId_branchId_dayOfWeek: {
          servicePackageId: pkg.id, branchId: schedule.branchId, dayOfWeek: schedule.dayOfWeek,
        } }, create: { servicePackageId: pkg.id, ...schedule }, update: { sessions: schedule.sessions },
      });
    }
    return pkg;
  });
}
