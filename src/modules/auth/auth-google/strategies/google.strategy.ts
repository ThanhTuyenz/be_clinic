import { Inject, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../../../../config/config.type.js';
import { Services } from 'src/common/utils/constants.js';
import { IAuthService } from '../../auth-local/auth.js';
import { AuthProvidersEnum } from '../../auth-local/enums/auth-providers.enum.js';
import { SocialType } from '../../../../common/utils/social.type.js';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy) {
  constructor(
    @Inject(Services.AUTH) private readonly authService: IAuthService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {
    super({
      clientID:
        configService.get<string>('google.clientId', {
          infer: true,
        }) || '',
      clientSecret:
        configService.get<string>('google.clientSecret', {
          infer: true,
        }) || '',
      callbackURL: configService.get<string>('google.callbackURL', {
        infer: true,
      }),
      scope: ['profile', 'email'],
    });
  }

  async validate(accessToken: string, refreshToken: string, profile: Profile) {
    const primaryEmail = profile.emails?.[0]?.value;

    // Ưu tiên displayName để giữ đúng trật tự họ tên tiếng Việt
    const fullName =
      profile.displayName ||
      [profile.name?.familyName, profile.name?.givenName].filter(Boolean).join(' ') ||
      'Người dùng Google';

    const socialData: SocialType = {
      id: profile.id,
      email: primaryEmail,
      fullName,
      avatarUrl: profile.photos?.[0]?.value,
    };

    return this.authService.validateSocialLogin(
      AuthProvidersEnum.google,
      socialData,
    );
  }
}
