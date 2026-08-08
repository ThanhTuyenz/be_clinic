import { CreateUserDto } from './dtos/create-user.dto';
import { UpdateUserAdminDto } from './dtos/update-user-admin.dto';
import { UsersPaginationQueryDto } from './dtos/users-pagination-query.dto';
import { AssignRoleDto } from './dtos/assign-role.dto';
import { IUsersService } from './users';
import { RolePermissionDto } from '../../roles/dtos/create-role.dto';
export declare class UsersController {
    private readonly usersService;
    constructor(usersService: IUsersService);
    create(createUserDto: CreateUserDto): Promise<import("./entities/user.entity").User>;
    findAll(query: UsersPaginationQueryDto): Promise<import("./users").UsersPaginatedResult>;
    update(id: string, updateUserDto: UpdateUserAdminDto): Promise<import("./entities/user.entity").User>;
    remove(id: string): Promise<void>;
    assignRole(id: string, assignRoleDto: AssignRoleDto): Promise<import("./entities/user.entity").User>;
    removeRole(id: string): Promise<void>;
    assignCustomPermissions(id: string, permissions: RolePermissionDto[]): Promise<import("./entities/user.entity").User>;
    removeCustomPermissions(id: string): Promise<void>;
}
