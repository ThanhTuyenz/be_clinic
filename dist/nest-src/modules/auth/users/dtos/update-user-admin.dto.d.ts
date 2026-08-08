import { UserRole, UserStatus } from '../entities/user.entity';
import { RolePermissionDto } from '../../../roles/dtos/create-role.dto';
export declare class UpdateUserAdminDto {
    email?: string | null;
    fullName?: string | null;
    role?: UserRole;
    status?: UserStatus;
    roleId?: string | null;
    customPermissions?: RolePermissionDto[] | null;
    password?: string;
    isBlocked?: boolean;
    isDeleted?: boolean;
}
