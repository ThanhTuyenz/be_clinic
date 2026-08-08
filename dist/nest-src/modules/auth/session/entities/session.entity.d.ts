import { User } from '../../users/entities/user.entity';
import { EntityHelper } from 'src/common/utils/entity-helper';
import { ObjectId } from 'mongodb';
export declare class Session extends EntityHelper {
    _id: ObjectId;
    id: string;
    user: User;
    createdAt: Date;
    deletedAt: Date | null;
    setId(): void;
}
