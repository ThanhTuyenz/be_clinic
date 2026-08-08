import { EntityCondition } from 'src/common/utils/types/entity-condition.type';
import { CreateUserDto } from './dtos/create-user.dto';
import { User } from './entities/user.entity';
import { NullableType } from 'src/common/utils/types/nullable.type';
import { IPaginationOptions } from 'src/common/utils/types/pagination-options';
import { DeepPartial } from 'typeorm';

export type UsersPaginatedResult = {
  data: User[];
  total: number;
};

export type FindUsersOptions = IPaginationOptions & {
  email?: string;
  name?: string;
  isBlocked?: boolean;
  isDeleted?: boolean;
};

export interface IUsersService {
  createUser(createUserDto: CreateUserDto): Promise<User>;
  findOneUser(options: EntityCondition<User>): Promise<NullableType<User>>;
  findByEmail(email: string): Promise<NullableType<User>>;
  findUsersWithPagination(
    options: FindUsersOptions,
  ): Promise<UsersPaginatedResult>;
  updateUser(id: User['id'], payload: DeepPartial<User>): Promise<User>;
  deleteUser(id: User['id']): Promise<void>;
  saveUser(user: User): Promise<User>;
  assignRole(userId: string, roleId: string): Promise<User>;
  removeRole(userId: string): Promise<User>;
}
