import type { IRolesService } from './roles.js';
export declare class RolesService implements IRolesService {
    findOne(roleId: string): Promise<{
        id: string;
        name: string;
    }>;
}
