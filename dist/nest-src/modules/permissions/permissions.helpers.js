"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateGlobalPermissions = generateGlobalPermissions;
exports.generatePermission = generatePermission;
exports.grantedMatchRequired = grantedMatchRequired;
exports.getPermittedResourcesIds = getPermittedResourcesIds;
const class_validator_1 = require("class-validator");
const enums_1 = require("./enums");
function generateGlobalPermissions(role) {
    switch (role) {
        case enums_1.PermissionRole.SUPER_ADMIN:
            return [
                generatePermission(enums_1.PermissionResource.ANY, enums_1.PermissionAction.ANY, enums_1.PermissionResourceTarget.ANY),
            ];
        case enums_1.PermissionRole.ADMIN:
            return [
                generatePermission(enums_1.PermissionResource.ANY, enums_1.PermissionAction.ANY, enums_1.PermissionResourceTarget.ANY),
            ];
        case enums_1.PermissionRole.STAFF:
            return [
                generatePermission(enums_1.PermissionResource.USER, enums_1.PermissionAction.GET, enums_1.PermissionResourceTarget.ANY),
                generatePermission(enums_1.PermissionResource.USER, enums_1.PermissionAction.EDIT, enums_1.PermissionResourceTarget.SOME),
            ];
        case enums_1.PermissionRole.USER:
            return [
                generatePermission(enums_1.PermissionResource.USER, enums_1.PermissionAction.GET, enums_1.PermissionResourceTarget.SOME),
                generatePermission(enums_1.PermissionResource.USER, enums_1.PermissionAction.EDIT, enums_1.PermissionResourceTarget.SOME),
            ];
        default:
            throw new Error(`Unsupported permission role: ${role}`);
    }
}
function generatePermission(resourceType, action, target, effect = enums_1.PermissionEffect.ALLOW) {
    return {
        resourceTarget: target,
        action,
        resourceType,
        effect,
    };
}
function grantedMatchRequired(grantedPermissions, requiredPermission) {
    if (requiredPermission.effect !== enums_1.PermissionEffect.ALLOW) {
        throw new Error('should only be used with ALLOW effect permissions');
    }
    const matchingPermissions = grantedPermissions.filter((p) => (p.resourceType === requiredPermission.resourceType ||
        p.resourceType === enums_1.PermissionResource.ANY) &&
        (p.action === requiredPermission.action ||
            p.action === enums_1.PermissionAction.ANY) &&
        (p.resourceTarget === requiredPermission.resourceTarget ||
            p.resourceTarget === enums_1.PermissionResourceTarget.ANY));
    if (!matchingPermissions.length) {
        return false;
    }
    return !matchingPermissions.some((p) => p.effect === enums_1.PermissionEffect.DENY);
}
function getPermittedResourcesIds(grantedPermissions, requiredPermission, effect) {
    return grantedPermissions
        .filter((p) => p.effect === effect &&
        [enums_1.PermissionResource.ANY, requiredPermission.resourceType].includes(p.resourceType) &&
        [enums_1.PermissionAction.ANY, requiredPermission.action].includes(p.action) &&
        (0, class_validator_1.isUUID)(p.resourceTarget))
        .map((p) => p.resourceTarget);
}
//# sourceMappingURL=permissions.helpers.js.map