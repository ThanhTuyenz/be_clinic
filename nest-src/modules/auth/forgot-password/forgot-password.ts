export type ForgotPasswordCreate = Partial<ForgotPassword>;
import { ForgotPassword } from './entities/forgot-password.entity';
import { FindOptions } from 'src/common/utils/types/find-options.type';
import { NullableType } from 'src/common/utils/types/nullable.type';

export interface IForgotPasswordService {
  create(data: ForgotPasswordCreate): Promise<ForgotPassword>;
  softDelete(id: ForgotPassword['id']): Promise<void>;
  findOne(
    options: FindOptions<ForgotPassword>,
  ): Promise<NullableType<ForgotPassword>>;
}
