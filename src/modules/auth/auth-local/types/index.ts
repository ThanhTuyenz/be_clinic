import { Session } from 'src/modules/auth/session/entities/session.entity';
import { User } from '../../users/entities/user.entity';

export type JwtPayloadType = Pick<User, 'id'> & {
  sessionId: Session['id'];
  iat: number;
  exp: number;
};

export type JwtRefreshPayloadType = {
  sessionId: Session['id'];
  id?: User['id'];
  iat: number;
  exp: number;
};

export type LoginResponseType = Readonly<{
  token: string;
  refreshToken: string;
  tokenExpires: number;
  user: User;
}>;
