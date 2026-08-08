import { DeepPartial, Repository } from 'typeorm';
import { EntityCondition } from 'src/common/utils/types/entity-condition.type';
import { NullableType } from 'src/common/utils/types/nullable.type';
import { CreateUserDto } from './dtos/create-user.dto';
import { User } from './entities/user.entity';
import { FindUsersOptions, IUsersService, UsersPaginatedResult } from './users';
import { HistoryService } from '../../history/history.service';
import { IRolesService } from '../../roles/roles';
import { PermissionsService } from '../../permissions/permissions.service';
export declare class UsersService implements IUsersService {
    private readonly usersRepository;
    private readonly historyService;
    private readonly rolesService;
    private readonly permissionsService;
    constructor(usersRepository: Repository<User>, historyService: HistoryService, rolesService: IRolesService, permissionsService: PermissionsService);
    createUser(createUserDto: CreateUserDto): Promise<User>;
    findOneUser(options: EntityCondition<User>): Promise<NullableType<User>>;
    private escapeRegex;
    findUsersWithPagination(options: FindUsersOptions): Promise<UsersPaginatedResult>;
    findByEmail(email: string): Promise<User | null>;
    updateUser(id: User['id'], payload: DeepPartial<User>): Promise<User>;
    deleteUser(id: User['id']): Promise<void>;
    saveUser(user: User): Promise<User>;
    assignRole(userId: string, roleId: string): Promise<User>;
    removeRole(userId: string): Promise<User>;
}
