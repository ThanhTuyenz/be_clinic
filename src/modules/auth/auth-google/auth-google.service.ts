import {
  Injectable,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { AllConfigType } from '../../../config/config.type';
import { AuthGoogleLoginDto } from './dtos/auth-google-login.dto';
import { SocialType } from '../../../common/utils/social.type';

@Injectable()
export class AuthGoogleService {
  private readonly google = new OAuth2Client();
  private readonly clientId: string;

  constructor(configService: ConfigService<AllConfigType>) {
    this.clientId = configService.getOrThrow<string>('google.clientId', {
      infer: true,
    });
  }

  async getProfileByToken(loginDto: AuthGoogleLoginDto): Promise<SocialType> {
    let data;
    try {
      const ticket = await this.google.verifyIdToken({
        idToken: loginDto.idToken,
        audience: this.clientId,
      });
      data = ticket.getPayload();
    } catch {
      throw new UnauthorizedException('Mã Google ID Token không hợp lệ hoặc đã hết hạn.');
    }

    if (!data?.sub || !data?.email) {
      throw new UnprocessableEntityException('Không thể lấy thông tin tài khoản từ Google Token.');
    }

    return {
      id: data.sub,
      email: data.email,
      fullName: data.name || [data.family_name, data.given_name].filter(Boolean).join(' ') || data.email.split('@')[0],
      avatarUrl: data.picture,
    };
  }
}

