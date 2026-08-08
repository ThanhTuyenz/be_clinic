import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { IRolesService } from '../roles/roles';
import { PermissionRole } from './enums';
import { Permission } from './types/permission.type';
import { PermissionsCacheService } from './services/permissions-cache.service';
export declare class PermissionsService {
    private readonly prisma;
    private readonly cacheService;
    private readonly rolesService;
    private readonly logger;
    constructor(prisma: PrismaService, cacheService: PermissionsCacheService, rolesService: IRolesService);
    getMany(userId: string): Promise<{
        role: PermissionRole;
        permissions: Permission[];
    }>;
    invalidateCache(userId: string): void;
    invalidateAllCache(): void;
}
