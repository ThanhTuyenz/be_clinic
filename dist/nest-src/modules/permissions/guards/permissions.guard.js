"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var PermissionsGuard_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PermissionsGuard = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const class_validator_1 = require("class-validator");
const permissions_decorator_1 = require("../decorators/permissions.decorator");
const skip_permissions_decorator_1 = require("../decorators/skip-permissions.decorator");
const enums_1 = require("../enums");
const permissions_helpers_1 = require("../permissions.helpers");
const permissions_service_1 = require("../permissions.service");
const permission_exceptions_1 = require("../exceptions/permission.exceptions");
const audit_log_service_1 = require("../services/audit-log.service");
const public_decorator_1 = require("../../../common/decorators/public.decorator");
let PermissionsGuard = PermissionsGuard_1 = class PermissionsGuard {
    permissionsService;
    reflector;
    auditLogService;
    logger = new common_1.Logger(PermissionsGuard_1.name);
    constructor(permissionsService, reflector, auditLogService) {
        this.permissionsService = permissionsService;
        this.reflector = reflector;
        this.auditLogService = auditLogService;
    }
    async canActivate(context) {
        const skipPermissions = this.reflector.getAllAndOverride(skip_permissions_decorator_1.SKIP_PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
        if (skipPermissions) {
            this.logger.log('Skipping permission check for this route');
            return true;
        }
        const isPublic = this.reflector.getAllAndOverride(public_decorator_1.IS_PUBLIC_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (isPublic) {
            return true;
        }
        const request = context.switchToHttp().getRequest();
        const userRole = request.user?.role;
        if (!userRole) {
            this.logger.warn('No user found in request');
            return false;
        }
        if (userRole === enums_1.PermissionRole.ADMIN) {
            return true;
        }
        if (!request.user?.id) {
            this.logger.warn('No user found in request');
            return false;
        }
        const requiredPermission = this.getRequiredPermission(context);
        const ipAddress = this.getClientIp(request);
        const userAgent = request.headers['user-agent'];
        const { role, permissions: grantedPermissions } = await this.permissionsService.getMany(request.user.id);
        if (!grantedPermissions.length) {
            this.logger.warn(`No permissions found for user ${request.user.id}`);
            this.auditLogService.logPermissionDenied(request.user.id, request.user.email, request.user.role, requiredPermission, 'No permissions found for user', ipAddress, userAgent);
            throw new permission_exceptions_1.InsufficientPermissionsException(requiredPermission.resourceType, requiredPermission.action, requiredPermission.resourceTarget);
        }
        const permitted = (0, permissions_helpers_1.grantedMatchRequired)(grantedPermissions, requiredPermission);
        if (!permitted) {
            this.logger.warn(`Permission denied for user ${request.user.id}: ${requiredPermission.action} on ${requiredPermission.resourceType}:${requiredPermission.resourceTarget}`);
            this.auditLogService.logPermissionDenied(request.user.id, request.user.email, request.user.role, requiredPermission, 'Insufficient permissions', ipAddress, userAgent);
            throw new permission_exceptions_1.InsufficientPermissionsException(requiredPermission.resourceType, requiredPermission.action, requiredPermission.resourceTarget);
        }
        let allowedResourcesIds = null;
        let deniedResourcesIds = null;
        if (requiredPermission.resourceTarget === enums_1.PermissionResourceTarget.SOME) {
            if ([enums_1.PermissionRole.PATIENT, enums_1.PermissionRole.EMPLOYEE].includes(role)) {
                allowedResourcesIds = (0, permissions_helpers_1.getPermittedResourcesIds)(grantedPermissions, requiredPermission, enums_1.PermissionEffect.ALLOW);
            }
            else if (role === enums_1.PermissionRole.ADMIN) {
                deniedResourcesIds = (0, permissions_helpers_1.getPermittedResourcesIds)(grantedPermissions, requiredPermission, enums_1.PermissionEffect.DENY);
            }
        }
        request.permissionsContext = {
            allowedResourcesIds,
            deniedResourcesIds,
            grantedPermissions,
        };
        this.auditLogService.logPermissionGranted(request.user.id, request.user.email, request.user.role, requiredPermission, ipAddress, userAgent);
        this.logger.log(`Permission granted for user ${request.user.id}: ${requiredPermission.action} on ${requiredPermission.resourceType}:${requiredPermission.resourceTarget}`);
        return true;
    }
    getRequiredPermission(context) {
        const permission = this.reflector.get(permissions_decorator_1.REQUIRED_PERMISSION, context.getHandler());
        const request = context.switchToHttp().getRequest();
        if (!permission) {
            throw new permission_exceptions_1.MissingPermissionDefinitionException(request.method, request.url);
        }
        if (permission.resourceTarget instanceof Function) {
            const resourceId = permission.resourceTarget(request);
            if (!(0, class_validator_1.isUUID)(resourceId)) {
                throw new permission_exceptions_1.InvalidResourceIdException(resourceId, 'Resource ID must be a valid UUID');
            }
            return {
                ...permission,
                resourceTarget: resourceId,
            };
        }
        return permission;
    }
    getClientIp(request) {
        const forwarded = request.headers['x-forwarded-for'];
        if (forwarded) {
            return Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
        }
        return request.ip || request.socket.remoteAddress || 'unknown';
    }
};
exports.PermissionsGuard = PermissionsGuard;
exports.PermissionsGuard = PermissionsGuard = PermissionsGuard_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [permissions_service_1.PermissionsService,
        core_1.Reflector,
        audit_log_service_1.AuditLogService])
], PermissionsGuard);
//# sourceMappingURL=permissions.guard.js.map