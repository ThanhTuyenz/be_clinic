import { Permission } from '../types/permission.type';
export interface PermissionAuditLog {
    timestamp: Date;
    userId: string;
    userEmail?: string;
    userRole?: string;
    action: string;
    resourceType: string;
    resourceTarget: string;
    result: 'GRANTED' | 'DENIED';
    reason?: string;
    ipAddress?: string;
    userAgent?: string;
    requestId?: string;
}
export declare class AuditLogService {
    private readonly logger;
    logPermissionCheck(log: PermissionAuditLog): void;
    logPermissionGranted(userId: string, userEmail: string | undefined, userRole: string | undefined, requiredPermission: Permission, ipAddress?: string, userAgent?: string): void;
    logPermissionDenied(userId: string, userEmail: string | undefined, userRole: string | undefined, requiredPermission: Permission, reason: string, ipAddress?: string, userAgent?: string): void;
    private formatLogMessage;
}
