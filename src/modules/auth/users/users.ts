import { EntityCondition } from 'src/common/utils/types/entity-condition.type';
import { CreateUserDto } from './dtos/create-user.dto';
import { User } from './entities/user.entity';
import { NullableType } from 'src/common/utils/types/nullable.type';
import { IPaginationOptions } from 'src/common/utils/types/pagination-options';

export type UserUpdate = Omit<Partial<User>, 'customPermissions'> & {
  customPermissions?: unknown[] | null;
  phoneNumber?: string | null;
  avatarUrl?: string | null;
  branchId?: string | null;
  specialtyId?: number | null;
  roomId?: string | null;
  academicRank?: string | null;
  licenseNumber?: string | null;
  experienceYears?: number | null;
  consultationFee?: number | null;
  slotDuration?: number | null;
  isFeatured?: boolean | null;
  biography?: string | null;
};

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
  /**
   * Tìm user theo nhiều biến thể số điện thoại trong 1 query (thay thế N+1 queries).
   * @param variants Mảng các biến thể SĐT (e.g., ['0912...', '+84912...'])
   */
  findByPhoneVariants(variants: string[]): Promise<NullableType<User>>;
  findUsersWithPagination(
    options: FindUsersOptions,
  ): Promise<UsersPaginatedResult>;
  updateUser(id: User['id'], payload: UserUpdate): Promise<User>;
  deleteUser(id: User['id']): Promise<void>;
  saveUser(user: User): Promise<User>;
  assignRole(userId: string, roleId: string): Promise<User>;
  removeRole(userId: string): Promise<User>;
}

