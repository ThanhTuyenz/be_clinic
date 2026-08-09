import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import { Session } from './entities/session.entity.js';
import { User } from '../users/entities/user.entity.js';
import { FindOptions } from '../../../common/utils/types/find-options.type.js';
import { NullableType } from '../../../common/utils/types/nullable.type.js';
import { ISessionService, SessionCreate } from './session.js';
export declare class SessionService implements ISessionService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    findOne(options: FindOptions<Session>): Promise<NullableType<Session>>;
    findMany(options: FindOptions<Session>): Promise<Session[]>;
    create(data: SessionCreate): Promise<Session>;
    softDelete({ excludeId, ...criteria }: {
        id?: Session['id'];
        user?: Pick<User, 'id'>;
        excludeId?: Session['id'];
    }): Promise<void>;
    private toWhere;
    private toEntity;
    private toUser;
}
