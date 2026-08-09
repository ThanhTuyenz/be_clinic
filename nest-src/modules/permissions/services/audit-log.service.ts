import { Injectable, Logger } from '@nestjs/common';
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

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  /**
   * Log a permission check event
   */
  logPermissionCheck(log: PermissionAuditLog): void {
    const logMessage = this.formatLogMessage(log);

    if (log.result === 'DENIED') {
      this.logger.warn(logMessage);
    } else {
      this.logger.log(logMessage);
    }

    // TODO: In production, send to external audit system (e.g., Elasticsearch, CloudWatch, Datadog)
    // this.sendToAuditSystem(log);
  }

  /**
   * Log successful permission grant
   */
  logPermissionGranted(
    userId: string,
    userEmail: string | undefined,
    userRole: string | undefined,
    requiredPermission: Permission,
    ipAddress?: string,
    userAgent?: string,
  ): void {
    this.logPermissionCheck({
      timestamp: new Date(),
      userId,
      userEmail,
      userRole,
      action: requiredPermission.action,
      resourceType: requiredPermission.resourceType,
      resourceTarget: requiredPermission.resourceTarget,
      result: 'GRANTED',
      ipAddress,
      userAgent,
    });
  }

  /**
   * Log permission denial
   */
  logPermissionDenied(
    userId: string,
    userEmail: string | undefined,
    userRole: string | undefined,
    requiredPermission: Permission,
    reason: string,
    ipAddress?: string,
    userAgent?: string,
  ): void {
    this.logPermissionCheck({
      timestamp: new Date(),
      userId,
      userEmail,
      userRole,
      action: requiredPermission.action,
      resourceType: requiredPermission.resourceType,
      resourceTarget: requiredPermission.resourceTarget,
      result: 'DENIED',
      reason,
      ipAddress,
      userAgent,
    });
  }

  private formatLogMessage(log: PermissionAuditLog): string {
    const parts = [
      `[AUDIT]`,
      `User=${log.userId}`,
      log.userEmail ? `Email=${log.userEmail}` : null,
      log.userRole ? `Role=${log.userRole}` : null,
      `Action=${log.action}`,
      `Resource=${log.resourceType}:${log.resourceTarget}`,
      `Result=${log.result}`,
      log.reason ? `Reason=${log.reason}` : null,
      log.ipAddress ? `IP=${log.ipAddress}` : null,
    ].filter(Boolean);

    return parts.join(' | ');
  }
}
