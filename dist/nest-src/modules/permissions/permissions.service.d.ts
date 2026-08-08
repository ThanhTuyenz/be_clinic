import { Repository } from 'typeorm';
import { User } from '../auth/users/entities/user.entity';
import { IRolesService } from '../roles/roles';
import { PermissionRole } from './enums';
import { Permission } from './types/permission.type';
import { PermissionsCacheService } from './services/permissions-cache.service';
export declare class PermissionsService {
    private readonly usersRepository;
    private readonly cacheService;
    private readonly rolesService;
    private readonly logger;
    constructor(usersRepository: Repository<User>, cacheService: PermissionsCacheService, rolesService: IRolesService);
    getMany(userId: string): Promise<{
        role: PermissionRole;
        permissions: Permission[];
    }>;
    invalidateCache(userId: string): void;
    invalidateAllCache(): void;
}
