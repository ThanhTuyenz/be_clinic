import { UserRole } from '../../users/entities/user.entity.js';

export enum PermissionRole {
  ADMIN = 'admin',
  EMPLOYEE = 'employee',
  PATIENT = 'patient',
}

export function mapUserRoleToPermissionRole(userRole: UserRole): PermissionRole {
  switch (userRole) {
    case UserRole.Admin:
    case UserRole.BranchManager:
      return PermissionRole.ADMIN;
    case UserRole.Doctor:
    case UserRole.Receptionist:
      return PermissionRole.EMPLOYEE;
    case UserRole.Patient:
      return PermissionRole.PATIENT;
    default:
      throw new Error(`Unsupported user role: ${userRole}`);
  }
}
