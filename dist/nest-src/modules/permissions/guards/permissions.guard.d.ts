import { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsService } from '../permissions.service';
import { AuditLogService } from '../services/audit-log.service';
export declare class PermissionsGuard implements CanActivate {
    private readonly permissionsService;
    private readonly reflector;
    private readonly auditLogService;
    private readonly logger;
    constructor(permissionsService: PermissionsService, reflector: Reflector, auditLogService: AuditLogService);
    canActivate(context: ExecutionContext): Promise<boolean>;
    private getRequiredPermission;
    private getClientIp;
}
