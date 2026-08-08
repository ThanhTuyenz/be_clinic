"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var AuditLogService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditLogService = void 0;
const common_1 = require("@nestjs/common");
let AuditLogService = AuditLogService_1 = class AuditLogService {
    logger = new common_1.Logger(AuditLogService_1.name);
    logPermissionCheck(log) {
        const logMessage = this.formatLogMessage(log);
        if (log.result === 'DENIED') {
            this.logger.warn(logMessage);
        }
        else {
            this.logger.log(logMessage);
        }
    }
    logPermissionGranted(userId, userEmail, userRole, requiredPermission, ipAddress, userAgent) {
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
    logPermissionDenied(userId, userEmail, userRole, requiredPermission, reason, ipAddress, userAgent) {
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
    formatLogMessage(log) {
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
};
exports.AuditLogService = AuditLogService;
exports.AuditLogService = AuditLogService = AuditLogService_1 = __decorate([
    (0, common_1.Injectable)()
], AuditLogService);
//# sourceMappingURL=audit-log.service.js.map