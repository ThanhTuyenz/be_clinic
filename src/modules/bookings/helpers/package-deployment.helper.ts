import { Prisma } from '@prisma/client';

// A package has one method. Branches only determine where it is deployed.
export const PACKAGE_DEPLOYMENT_SELECT = {
  bookingMethodId: true,
  bookingMethod: { select: { id: true, code: true, name: true, isActive: true } },
  branches: { select: {
    branchId: true,
    branch: { select: {
      id: true, code: true, slug: true, name: true, address: true, isActive: true,
      bookingMethods: { select: { id: true, branchId: true, bookingMethodId: true, isEnabled: true } },
    } },
  } },
} satisfies Prisma.ServicePackageSelect;

type PackageDeployment = Prisma.ServicePackageGetPayload<{ select: typeof PACKAGE_DEPLOYMENT_SELECT }>;

export function getPackageDeployments(pkg: PackageDeployment) {
  return pkg.branches.flatMap(({ branch }) => branch.bookingMethods
    .filter(method => method.bookingMethodId === pkg.bookingMethodId)
    .map(method => ({
      ...method,
      isEnabled: method.isEnabled && branch.isActive && pkg.bookingMethod.isActive,
      branch: { id: branch.id, code: branch.code, slug: branch.slug, name: branch.name, address: branch.address, isActive: branch.isActive },
      bookingMethod: pkg.bookingMethod,
    })));
}

// Correlate each branch's enabled method with the package's single method.
export async function packageDeploymentWhere(
  db: Pick<Prisma.TransactionClient, 'branchBookingMethod'>,
  branchId?: number,
  code?: string,
): Promise<Prisma.ServicePackageWhereInput> {
  const methods = await db.branchBookingMethod.findMany({
    where: { ...(branchId ? { branchId } : {}), isEnabled: true,
      branch: { isActive: true }, bookingMethod: { isActive: true, ...(code ? { code } : {}) } },
    select: { branchId: true, bookingMethodId: true },
  });
  return { OR: methods.map(method => ({
    bookingMethodId: method.bookingMethodId,
    branches: { some: { branchId: method.branchId } },
  })) };
}
