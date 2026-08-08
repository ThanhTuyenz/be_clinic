import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PermissionRole } from '../enums';
import { Permission } from '../types/permission.type';
export interface CachedPermissions {
    role: PermissionRole;
    permissions: Permission[];
    cachedAt: number;
}
export declare class PermissionsCacheService implements OnModuleInit, OnModuleDestroy {
    private readonly configService;
    private readonly logger;
    private readonly cache;
    private readonly ttl;
    private cleanupInterval?;
    constructor(configService: ConfigService);
    onModuleInit(): void;
    onModuleDestroy(): void;
    get(userId: string): CachedPermissions | null;
    set(userId: string, role: PermissionRole, permissions: Permission[]): void;
    invalidate(userId: string): void;
    invalidateAll(): void;
    getStats(): {
        size: number;
        ttl: number;
    };
    private cleanupExpired;
}
