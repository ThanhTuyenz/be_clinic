import { PermissionAction, PermissionEffect, PermissionResourceTarget, PermissionResource, PermissionRole } from './enums';
import { Permission } from './types/permission.type';
export declare function generateGlobalPermissions(role: PermissionRole): Permission[];
export declare function generatePermission(resourceType: PermissionResource, action: PermissionAction, target: PermissionResourceTarget | string, effect?: PermissionEffect): Permission;
export declare function grantedMatchRequired(grantedPermissions: Permission[], requiredPermission: Permission): boolean;
export declare function getPermittedResourcesIds(grantedPermissions: Permission[], requiredPermission: Permission, effect: PermissionEffect): string[];
