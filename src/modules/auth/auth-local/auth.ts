import { NullableType } from 'src/common/utils/types/nullable.type';
import { AuthEmailLoginDto, AuthRegisterDto } from './dtos/index.js';
import { LoginResponseType, JwtPayloadType, JwtRefreshPayloadType } from './types/index.js';
import { User } from '../users/entities/user.entity';
import { AuthProvidersEnum } from './enums/auth-providers.enum';
import { SocialType } from '../../../common/utils/social.type';

export interface IAuthService {
  validateLogin(loginDto: AuthEmailLoginDto): Promise<LoginResponseType>;
  registerUser(registerDto: AuthRegisterDto): Promise<void>;
  verifyRegistrationOtp(email: string, otp: string): Promise<void>;
  resendRegistrationOtp(email: string): Promise<void>;
  checkEmail(email: string): Promise<boolean>;
  status(userJwtPayload: JwtPayloadType): Promise<NullableType<User>>;
  confirmEmail(hash: string): Promise<void>;
  forgotPassword(email: string): Promise<void>;
  resetPassword(hash: string, password: string): Promise<void>;
  validateSocialLogin(
    authProvider: AuthProvidersEnum,
    socialData: SocialType,
  ): Promise<LoginResponseType>;
  refreshToken(
    data: Pick<JwtRefreshPayloadType, 'sessionId' | 'id'>,
  ): Promise<Omit<LoginResponseType, 'user'>>;

  refreshTokenFromCookie(
    refreshToken: string,
  ): Promise<Omit<LoginResponseType, 'user'>>;

  logout(data: { sessionId?: string; token?: string }): Promise<void>;
}
