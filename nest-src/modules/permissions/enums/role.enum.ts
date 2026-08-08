import { UserRole } from '../../auth/users/entities/user.entity';

export enum PermissionRole {
  SUPER_ADMIN = 'super_admin',
  ADMIN = 'admin',
  STAFF = 'staff',
  USER = 'user',
}

export function mapUserRoleToPermissionRole(
  userRole: UserRole,
): PermissionRole {
  switch (userRole) {
    case UserRole.SuperAdmin:
      return PermissionRole.SUPER_ADMIN;
    case UserRole.Admin:
    case UserRole.BranchManager:
      return PermissionRole.ADMIN;
    case UserRole.Staff:
    case UserRole.Doctor:
    case UserRole.Pharmacist:
    case UserRole.Cashier:
    case UserRole.Receptionist:
      return PermissionRole.STAFF;
    case UserRole.User:
    case UserRole.Patient:
      return PermissionRole.USER;
    default:
      throw new Error(`Unsupported user role: ${userRole}`);
  }
}
