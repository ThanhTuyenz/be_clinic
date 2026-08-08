import { UserRole, UserStatus } from '../entities/user.entity';
import { AuthProvidersEnum } from '../../auth-local/enums/auth-providers.enum';
import { RolePermissionDto } from '../../../roles/dtos/create-role.dto';
export declare class CreateUserDto {
    email: string | null;
    password?: string;
    fullName: string | null;
    role?: UserRole;
    roleId?: string;
    customPermissions?: RolePermissionDto[];
    status?: UserStatus;
    provider?: AuthProvidersEnum;
    socialId?: string | null;
    hash?: string | null;
}
