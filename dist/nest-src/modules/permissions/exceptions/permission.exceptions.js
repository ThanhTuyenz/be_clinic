"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MissingPermissionDefinitionException = exports.InvalidResourceIdException = exports.ResourceNotFoundException = exports.InsufficientPermissionsException = exports.PermissionErrorCode = void 0;
const common_1 = require("@nestjs/common");
var PermissionErrorCode;
(function (PermissionErrorCode) {
    PermissionErrorCode["INSUFFICIENT_PERMISSIONS"] = "INSUFFICIENT_PERMISSIONS";
    PermissionErrorCode["RESOURCE_NOT_FOUND"] = "RESOURCE_NOT_FOUND";
    PermissionErrorCode["INVALID_RESOURCE_ID"] = "INVALID_RESOURCE_ID";
    PermissionErrorCode["PERMISSION_DENIED"] = "PERMISSION_DENIED";
    PermissionErrorCode["MISSING_PERMISSION_DEFINITION"] = "MISSING_PERMISSION_DEFINITION";
})(PermissionErrorCode || (exports.PermissionErrorCode = PermissionErrorCode = {}));
class InsufficientPermissionsException extends common_1.ForbiddenException {
    resourceType;
    action;
    resourceTarget;
    constructor(resourceType, action, resourceTarget) {
        super({
            statusCode: common_1.HttpStatus.FORBIDDEN,
            error: PermissionErrorCode.INSUFFICIENT_PERMISSIONS,
            message: `Insufficient permissions to ${action} ${resourceType}${resourceTarget !== '*' ? ` with id ${resourceTarget}` : ''}`,
            details: {
                resourceType,
                action,
                resourceTarget,
            },
        });
        this.resourceType = resourceType;
        this.action = action;
        this.resourceTarget = resourceTarget;
    }
}
exports.InsufficientPermissionsException = InsufficientPermissionsException;
class ResourceNotFoundException extends common_1.HttpException {
    resourceType;
    resourceId;
    constructor(resourceType, resourceId) {
        super({
            statusCode: common_1.HttpStatus.NOT_FOUND,
            error: PermissionErrorCode.RESOURCE_NOT_FOUND,
            message: `Resource ${resourceType} with id ${resourceId} not found`,
            details: {
                resourceType,
                resourceId,
            },
        }, common_1.HttpStatus.NOT_FOUND);
        this.resourceType = resourceType;
        this.resourceId = resourceId;
    }
}
exports.ResourceNotFoundException = ResourceNotFoundException;
class InvalidResourceIdException extends common_1.HttpException {
    resourceId;
    reason;
    constructor(resourceId, reason) {
        super({
            statusCode: common_1.HttpStatus.BAD_REQUEST,
            error: PermissionErrorCode.INVALID_RESOURCE_ID,
            message: `Invalid resource id: ${reason}`,
            details: {
                resourceId,
                reason,
            },
        }, common_1.HttpStatus.BAD_REQUEST);
        this.resourceId = resourceId;
        this.reason = reason;
    }
}
exports.InvalidResourceIdException = InvalidResourceIdException;
class MissingPermissionDefinitionException extends common_1.HttpException {
    method;
    url;
    constructor(method, url) {
        super({
            statusCode: common_1.HttpStatus.INTERNAL_SERVER_ERROR,
            error: PermissionErrorCode.MISSING_PERMISSION_DEFINITION,
            message: `Missing permission definition for ${method} ${url}`,
            details: {
                method,
                url,
            },
        }, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        this.method = method;
        this.url = url;
    }
}
exports.MissingPermissionDefinitionException = MissingPermissionDefinitionException;
//# sourceMappingURL=permission.exceptions.js.map