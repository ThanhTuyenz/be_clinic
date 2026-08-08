import { User } from '../users/entities/user.entity';
import { Session } from './entities/session.entity';
import { DeepPartial } from 'typeorm';
import { FindOptions } from 'src/common/utils/types/find-options.type';
import { NullableType } from 'src/common/utils/types/nullable.type';

export interface ISessionService {
  create(data: DeepPartial<Session>): Promise<Session>;
  findOne(options: FindOptions<Session>): Promise<NullableType<Session>>;
  findMany(options: FindOptions<Session>): Promise<Session[]>;
  softDelete({
    excludeId,
    ...criteria
  }: {
    id?: Session['id'];
    user?: Pick<User, 'id'>;
    excludeId?: Session['id'];
  }): Promise<void>;
}
