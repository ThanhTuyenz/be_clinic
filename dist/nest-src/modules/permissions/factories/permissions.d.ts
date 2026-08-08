import { Request as ExpressRequest } from 'express';
import { PermissionAction, PermissionResourceTarget, PermissionResource } from '../enums';
export declare const PERMISSIONS: unique symbol;
export declare class Permissions {
    private readonly request;
    constructor(request: ExpressRequest);
    canActivate(resourceType: PermissionResource, action: PermissionAction, target: PermissionResourceTarget | string): boolean;
    get allowedResourcesIds(): string[] | null;
    get deniedResourcesIds(): string[] | null;
    private get context();
}
