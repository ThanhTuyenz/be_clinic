import { SocialType } from '../../../common/utils/social.type';
import { AuthZaloLoginDto } from './dtos/auth-zalo-login.dto';

export interface IAuthZaloService {
  getProfileByToken(loginDto: AuthZaloLoginDto): Promise<SocialType>;
}
