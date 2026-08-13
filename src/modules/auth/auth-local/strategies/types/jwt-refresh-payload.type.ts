
import { Session } from 'src/modules/auth/session/entities/session.entity';
import { User } from '../../../users/entities/user.entity';

export type JwtRefreshPayloadType = {
  sessionId: Session['id'];
  id?: User['id'];
  iat: number;
  exp: number;
};
