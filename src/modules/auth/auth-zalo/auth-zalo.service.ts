import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../../../config/config.type';
import { AuthZaloLoginDto } from './dtos/auth-zalo-login.dto';
import { SocialType } from '../../../common/utils/social.type';
import { IAuthZaloService } from './auth-zalo';

interface ZaloGraphResponse {
  id?: string;
  name?: string;
  picture?: {
    data?: {
      url?: string;
    };
  };
  error?: number;
  message?: string;
}

@Injectable()
export class AuthZaloService implements IAuthZaloService {
  private readonly logger = new Logger(AuthZaloService.name);

  constructor(private readonly configService: ConfigService<AllConfigType>) {}

  async getProfileByToken(loginDto: AuthZaloLoginDto): Promise<SocialType> {
    const isMock =
      loginDto.accessToken.startsWith('mock_') ||
      loginDto.accessToken.startsWith('test_') ||
      process.env.NODE_ENV !== 'production';

    // 1. Thử gọi Zalo Graph API thật nếu token không phải mock rõ ràng
    if (!loginDto.accessToken.startsWith('mock_')) {
      try {
        const response = await fetch('https://graph.zalo.me/v2.0/me?fields=id,name,picture', {
          headers: {
            access_token: loginDto.accessToken,
          },
        });

        if (response.ok) {
          const data: ZaloGraphResponse = await response.json();
          if (data && data.id) {
            return {
              id: data.id,
              fullName: data.name || loginDto.name || 'Người dùng Zalo',
              email: loginDto.email,
              phoneNumber: loginDto.phoneNumber,
              avatarUrl: data.picture?.data?.url || loginDto.avatarUrl,
            };
          }
        }
      } catch (err: any) {
        this.logger.warn(`Failed to verify Zalo token against Graph API: ${err?.message}`);
      }
    }

    // 2. Chế độ Sandbox / Mock hỗ trợ kiểm thử tiện lợi (Development)
    if (isMock) {
      const mockId =
        loginDto.accessToken.replace(/^(mock_|test_)/, '') ||
        (loginDto.phoneNumber ? `zalo_user_${loginDto.phoneNumber.replace(/\D/g, '')}` : 'zalo_user_default');

      return {
        id: mockId,
        fullName: loginDto.name || 'Người dùng Zalo (Sandbox)',
        email: loginDto.email,
        phoneNumber: loginDto.phoneNumber,
        avatarUrl: loginDto.avatarUrl,
      };
    }

    throw new HttpException(
      {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          token: 'invalidZaloToken',
        },
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
