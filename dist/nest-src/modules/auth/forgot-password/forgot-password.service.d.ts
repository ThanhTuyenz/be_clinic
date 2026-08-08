import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import { IForgotPasswordService, ForgotPasswordCreate } from './forgot-password.js';
import { FindOptions } from '../../../common/utils/types/find-options.type.js';
import { ForgotPassword } from './entities/forgot-password.entity.js';
export declare class ForgotPasswordService implements IForgotPasswordService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    create(data: ForgotPasswordCreate): Promise<ForgotPassword>;
    findOne(options: FindOptions<ForgotPassword>): Promise<ForgotPassword | null>;
    softDelete(id: string): Promise<void>;
    private toEntity;
}
