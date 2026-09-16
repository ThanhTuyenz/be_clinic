import { User } from '../../users/entities/user.entity';

export class ForgotPassword {
  id: string;
  hash: string;
  user?: User | string | null;
  userId?: string | null;
  createdAt: Date;
  expiresAt?: Date;
  deletedAt?: Date | null;
}
