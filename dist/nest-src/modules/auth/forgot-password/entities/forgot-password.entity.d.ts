import { User } from '../../users/entities/user.entity';
import { EntityHelper } from 'src/common/utils/entity-helper';
import { ObjectId } from 'mongodb';
export declare class ForgotPassword extends EntityHelper {
    _id: ObjectId;
    id: string;
    hash: string;
    user?: User | string | null;
    userId?: string | null;
    createdAt: Date;
    deletedAt: Date | null;
    setId(): void;
}
