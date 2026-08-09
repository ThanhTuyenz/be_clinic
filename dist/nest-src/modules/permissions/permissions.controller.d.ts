import { Request as ExpressRequest } from 'express';
import { PermissionsService } from './permissions.service';
import { Permission } from './types/permission.type';
export declare class PermissionsController {
    private readonly permissionsService;
    constructor(permissionsService: PermissionsService);
    getManyForCurrentUser({ user }: ExpressRequest): Promise<Permission[]>;
}
