import { User } from '../../users/entities/user.entity';

export class Session {
  id: string;
  userId: string;
  user?: User;
  createdAt: Date;
  deletedAt?: Date | null;
}
