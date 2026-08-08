import { UserRole } from '../../auth/users/entities/user.entity';
export declare enum PermissionRole {
    SUPER_ADMIN = "super_admin",
    ADMIN = "admin",
    STAFF = "staff",
    USER = "user"
}
export declare function mapUserRoleToPermissionRole(userRole: UserRole): PermissionRole;
