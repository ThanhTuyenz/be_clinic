import { IForgotPasswordService } from './forgot-password';
import { FindOptions } from 'src/common/utils/types/find-options.type';
import { ForgotPassword } from './entities/forgot-password.entity';
import { DeepPartial, Repository } from 'typeorm';
export declare class ForgotPasswordService implements IForgotPasswordService {
    private readonly forgotPasswordRepository;
    constructor(forgotPasswordRepository: Repository<ForgotPassword>);
    create(data: DeepPartial<ForgotPassword>): Promise<ForgotPassword>;
    findOne(options: FindOptions<ForgotPassword>): Promise<ForgotPassword | null>;
    softDelete(id: ForgotPassword['id']): Promise<void>;
}
