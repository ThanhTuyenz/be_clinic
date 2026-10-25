import { Exclude } from 'class-transformer';
import { EntityHelper } from 'src/common/utils/entity-helper';

export enum UserStatus {
  Active = 'active',
  Inactive = 'inactive',
}

export enum UserRole {
  Admin = 'admin',
  ChainManager = 'chain_manager',
  BranchManager = 'branch_manager',
  Doctor = 'doctor',
  Receptionist = 'receptionist',
  Patient = 'patient',
}

// Model trả về cho API. Việc lưu trữ, UUID, timestamps và hash mật khẩu do Prisma/UsersService xử lý.
export class User extends EntityHelper {
  id: string;
  email: string | null;

  @Exclude({ toPlainOnly: true })
  password: string;

  provider: string;
  status: UserStatus;
  role: UserRole;
  socialId: string | null;
  zaloId: string | null;
  fullName: string | null;
  phoneNumber: string | null;
  avatarUrl: string | null;
  roleId: string | null;
  customPermissions: Array<{
    resourceType: string;
    action: string;
    resourceTarget: string;
    effect: string;
  }> | null;

  @Exclude({ toPlainOnly: true })
  hash: string | null;

  isBlocked: boolean;
  blockedAt: Date | null;
  isDeleted: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
