import { SocialType } from '../../../common/utils/social.type';
import { AuthGoogleLoginDto } from './dtos/auth-google-login.dto';

export interface IAuthGoogleService {
  getProfileByToken(loginDto: AuthGoogleLoginDto): Promise<SocialType>;
}
