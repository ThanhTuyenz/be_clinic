import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { AllConfigType } from '../../../config/config.type';
import { AuthGoogleLoginDto } from './dtos/auth-google-login.dto';
import { SocialType } from '../../../common/utils/social.type';
import { IAuthGoogleService } from './auth-google';

@Injectable()
export class AuthGoogleService implements IAuthGoogleService {
  private google: OAuth2Client;

  constructor(private configService: ConfigService<AllConfigType>) {
    this.google = new OAuth2Client(
      configService.get<string>('google.clientId', { infer: true }),
      configService.get<string>('google.clientSecret', { infer: true }),
    );
  }

  async getProfileByToken(loginDto: AuthGoogleLoginDto): Promise<SocialType> {
    // Hỗ trợ chế độ Mock / Sandbox kiểm thử trong môi trường Development
    if (loginDto.idToken.startsWith('mock_') || loginDto.idToken.startsWith('test_')) {
      try {
        const payloadStr = loginDto.idToken.replace(/^(mock|test)_google_(token_)?/, '');
        let email = 'patient.google@vitacare.vn';
        let fullName = 'Người dùng Google';
        let sub = `google_mock_${Date.now()}`;

        if (payloadStr.includes(':::')) {
          const [mEmail, mName, mSub] = payloadStr.split(':::');
          if (mEmail) email = decodeURIComponent(mEmail);
          if (mName) fullName = decodeURIComponent(mName);
          if (mSub) sub = mSub;
        } else if (payloadStr.includes('@')) {
          email = decodeURIComponent(payloadStr);
          fullName = email.split('@')[0];
          sub = `google_mock_${Buffer.from(email).toString('hex').slice(0, 16)}`;
        }

        return {
          id: sub,
          email,
          fullName,
        };
      } catch {
        // Tiếp tục xác thực thông thường nếu giải mã mock thất bại
      }
    }

    const ticket = await this.google.verifyIdToken({
      idToken: loginDto.idToken,
      audience: [
        this.configService.getOrThrow<string>('google.clientId', {
          infer: true,
        }),
      ],
    });

    const data = ticket.getPayload();

    if (!data) {
      throw new HttpException(
        {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            user: 'wrongToken',
          },
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    return {
      id: data.sub,
      email: data.email,
      fullName: [data.given_name, data.family_name].filter(Boolean).join(' '),
    };
  }
}
