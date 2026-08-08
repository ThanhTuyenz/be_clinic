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
      return PermissionRole.ADMIN;
    case UserRole.Staff:
      return PermissionRole.STAFF;
    case UserRole.User:
      return PermissionRole.USER;
    default:
      throw new Error(`Unsupported user role: ${userRole}`);
  }
}
