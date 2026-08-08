import { CustomDecorator } from '@nestjs/common/decorators/core/set-metadata.decorator';
import { Request as ExpressRequest } from 'express';
import { PermissionAction, PermissionResource, PermissionResourceTarget, PermissionEffect } from '../enums';
export { PermissionResource, PermissionAction, PermissionResourceTarget };
export { SkipPermissions } from './skip-permissions.decorator';
export type GetResourceIdFn = (req: ExpressRequest) => string;
export declare function GetResourceIdFromParams(req: ExpressRequest): string;
export declare const REQUIRED_PERMISSION: unique symbol;
export type RequiredPermission = {
    resourceType: PermissionResource;
    action: PermissionAction;
    resourceTarget: PermissionResourceTarget | GetResourceIdFn;
    effect: PermissionEffect.ALLOW;
};
export declare const RequiresPermission: (resourceType: PermissionResource, action: PermissionAction, resourceTarget: PermissionResourceTarget | GetResourceIdFn) => CustomDecorator<typeof REQUIRED_PERMISSION>;
