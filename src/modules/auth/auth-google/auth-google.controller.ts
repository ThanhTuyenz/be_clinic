import { Controller, Inject, Get, Post, Body, UseGuards, Req, Res, HttpStatus, HttpCode } from '@nestjs/common';
import type { Response, Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { Routes, Services } from 'src/common/utils/constants.js';
import { IAuthService } from '../auth-local/auth.js';
import { AuthProvidersEnum } from '../auth-local/enums/auth-providers.enum.js';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Public } from 'src/common/decorators/public.decorator.js';
import { SkipPermissions } from 'src/common/decorators';
import { AuthGoogleService } from './auth-google.service.js';
import { AuthGoogleLoginDto } from './dtos/auth-google-login.dto.js';
import { GoogleAuthGuard } from './guards/google-auth.guard.js';
import { LoginResponseType } from '../auth-local/types/index.js';

@ApiTags('Auth')
@Public()
@SkipPermissions()
@Controller(Routes.AUTH)
export class AuthGoogleController {
  constructor(
    @Inject(Services.AUTH) private readonly authService: IAuthService,
    private readonly authGoogleService: AuthGoogleService,
    private readonly configService: ConfigService,
  ) {}

  // 1. Bắt đầu quá trình xác thực Google OAuth2 (hỗ trợ cả /google và alias /google/login)
  @Get(['google', 'google/login'])
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Bắt đầu quá trình xác thực Google OAuth2' })
  async googleAuth() {
    // Passport tự động redirect sang trang đăng nhập của Google
  }

  // 2. Nhận kết quả callback từ Google (hỗ trợ cả /google/callback và alias /google/redirect)
  @Get(['google/callback', 'google/redirect'])
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Google OAuth2 callback redirect về Frontend' })
  async googleCallback(
    @Req() req: Request & { user?: LoginResponseType },
    @Res() res: Response,
  ) {
    return this.handleGoogleRedirect(req, res);
  }

  // 3. Đăng nhập trực tiếp bằng IdToken từ Google Button / Mobile App
  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đăng nhập Google bằng IdToken trực tiếp từ Client' })
  async googleTokenLogin(@Body() loginDto: AuthGoogleLoginDto) {
    const socialData = await this.authGoogleService.getProfileByToken(loginDto);
    return this.authService.validateSocialLogin(AuthProvidersEnum.google, socialData);
  }

  private handleGoogleRedirect(req: Request & { user?: LoginResponseType }, res: Response) {
    const loginResponse = req.user;
    let targetBase = this.configService.get<string>('FRONTEND_DOMAIN') || 'http://localhost:3000';

    // Đọc state từ request để biết client nào gọi tới (App Mobile hay Web Frontend)
    const state = req.query?.state;
    if (state && typeof state === 'string') {
      try {
        const decoded = decodeURIComponent(state);
        if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
          targetBase = decoded;
        }
      } catch {
        if (state.startsWith('http://') || state.startsWith('https://')) {
          targetBase = state;
        }
      }
    }

    const token = loginResponse?.token || '';
    const refreshToken = loginResponse?.refreshToken || '';

    const targetUrl = new URL('/auth/callback', targetBase);
    targetUrl.searchParams.set('token', token);
    if (refreshToken) {
      targetUrl.searchParams.set('refreshToken', refreshToken);
    }
    return res.redirect(targetUrl.toString());
  }
}
