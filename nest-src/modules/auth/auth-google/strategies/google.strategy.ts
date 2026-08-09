import { Inject, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../../../../config/config.type';
import { Services } from 'src/common/utils/constants';
import { IAuthService } from '../../auth-local/auth';
import { AuthProvidersEnum } from '../../auth-local/enums/auth-providers.enum';

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
    const socialData = {
      id: profile.id,
      email: primaryEmail,
      fullName: [profile.name?.givenName, profile.name?.familyName]
        .filter(Boolean)
        .join(' '),
    };

    // Assuming you have a method to handle social login validation
    const loginResponse = await this.authService.validateSocialLogin(
      AuthProvidersEnum.google,
      socialData,
    );

    return loginResponse;
  }
}
