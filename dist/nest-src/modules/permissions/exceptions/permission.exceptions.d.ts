import { ForbiddenException, HttpException } from '@nestjs/common';
export declare enum PermissionErrorCode {
    INSUFFICIENT_PERMISSIONS = "INSUFFICIENT_PERMISSIONS",
    RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND",
    INVALID_RESOURCE_ID = "INVALID_RESOURCE_ID",
    PERMISSION_DENIED = "PERMISSION_DENIED",
    MISSING_PERMISSION_DEFINITION = "MISSING_PERMISSION_DEFINITION"
}
export declare class InsufficientPermissionsException extends ForbiddenException {
    readonly resourceType: string;
    readonly action: string;
    readonly resourceTarget: string;
    constructor(resourceType: string, action: string, resourceTarget: string);
}
export declare class ResourceNotFoundException extends HttpException {
    readonly resourceType: string;
    readonly resourceId: string;
    constructor(resourceType: string, resourceId: string);
}
export declare class InvalidResourceIdException extends HttpException {
    readonly resourceId: string;
    readonly reason: string;
    constructor(resourceId: string, reason: string);
}
export declare class MissingPermissionDefinitionException extends HttpException {
    readonly method: string;
    readonly url: string;
    constructor(method: string, url: string);
}
