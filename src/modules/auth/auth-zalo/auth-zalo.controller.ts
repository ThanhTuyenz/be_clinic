import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Res,
} from '@nestjs/common';
import type { Response, CookieOptions } from 'express';
import { ConfigService } from '@nestjs/config';
import { Routes, Services } from '../../../common/utils/constants';
import { IAuthService } from '../auth-local/auth';
import { AuthProvidersEnum } from '../auth-local/enums/auth-providers.enum';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common/decorators/public.decorator';
import { SkipPermissions } from '../permissions/decorators/skip-permissions.decorator.js';
import { IAuthZaloService } from './auth-zalo';
import { AuthZaloLoginDto } from './dtos/auth-zalo-login.dto';
import { ttlToMilliseconds } from '../../../config/auth.config';

@ApiTags('Auth')
@Public()
@SkipPermissions()
@Controller(Routes.AUTH)
export class AuthZaloController {
  constructor(
    @Inject(Services.AUTH) private readonly authService: IAuthService,
    @Inject(Services.AUTH_ZALO) private readonly authZaloService: IAuthZaloService,
    private readonly configService: ConfigService,
  ) {}

  @Post('zalo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đăng nhập bằng Zalo SDK (access token + phone/profile)' })
  async zaloLogin(
    @Body() loginDto: AuthZaloLoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const socialData = await this.authZaloService.getProfileByToken(loginDto);
    const response = await this.authService.validateSocialLogin(
      AuthProvidersEnum.zalo,
      socialData,
    );

    const isProduction = process.env.NODE_ENV === 'production';
    const cookieOptions: CookieOptions = {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
    };

    const tokenExpires = this.configService.get<string>('auth.expires') || '15m';
    const refreshExpires = this.configService.get<string>('auth.refreshExpires') || '7d';

    try {
      res.cookie('token', response.token, {
        ...cookieOptions,
        maxAge: ttlToMilliseconds(tokenExpires),
      });
      res.cookie('refreshToken', response.refreshToken, {
        ...cookieOptions,
        maxAge: ttlToMilliseconds(refreshExpires),
      });
    } catch {
      // If cookie maxAge fails, continue without throwing
    }

    return response;
  }

  @Post('zalo/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đăng nhập bằng Zalo SDK (alias)' })
  async zaloLoginAlias(
    @Body() loginDto: AuthZaloLoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.zaloLogin(loginDto, res);
  }
}
