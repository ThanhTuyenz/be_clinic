import { Controller, Inject, Get, Post, Body, UseGuards, Req, Res, HttpStatus, HttpCode } from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { Routes, Services } from 'src/common/utils/constants';
import { IAuthService } from '../auth-local/auth';
import { AuthProvidersEnum } from '../auth-local/enums/auth-providers.enum';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Public } from 'src/common/decorators/public.decorator';
import { SkipPermissions } from '../permissions/decorators/skip-permissions.decorator.js';
import { IAuthGoogleService } from './auth-google';
import { AuthGoogleLoginDto } from './dtos/auth-google-login.dto';

@ApiTags('Auth')
@Public()
@SkipPermissions()
@Controller(Routes.AUTH)
export class AuthGoogleController {
  constructor(
    @Inject(Services.AUTH) private readonly authService: IAuthService,
    @Inject(Services.AUTH_GOOGLE) private readonly authGoogleService: IAuthGoogleService,
    private readonly configService: ConfigService,
  ) {}

  @Get('google')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Bắt đầu quá trình xác thực Google OAuth2' })
  async googleAuth() {
    // Passport redirects to Google
  }

  @Get('google/login')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Bắt đầu quá trình xác thực Google OAuth2 (alias login)' })
  async googleLogin() {
    // Passport redirects to Google
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Google OAuth2 callback redirect' })
  async googleCallback(@Req() req: any, @Res() res: Response) {
    return this.handleGoogleRedirect(req, res);
  }

  @Get('google/redirect')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Google OAuth2 redirect (alias callback)' })
  async googleRedirect(@Req() req: any, @Res() res: Response) {
    return this.handleGoogleRedirect(req, res);
  }

  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đăng nhập Google bằng IdToken trực tiếp từ Client' })
  async googleTokenLogin(@Body() loginDto: AuthGoogleLoginDto) {
    const socialData = await this.authGoogleService.getProfileByToken(loginDto);
    return this.authService.validateSocialLogin(AuthProvidersEnum.google, socialData);
  }

  private handleGoogleRedirect(req: any, res: Response) {
    const loginResponse = req.user;
    const frontendDomain = this.configService.get<string>('FRONTEND_DOMAIN') || 'http://localhost:3000';
    const token = loginResponse?.token || '';
    const refreshToken = loginResponse?.refreshToken || '';

    const targetUrl = new URL('/auth/callback', frontendDomain);
    targetUrl.searchParams.set('token', token);
    if (refreshToken) {
      targetUrl.searchParams.set('refreshToken', refreshToken);
    }
    return res.redirect(targetUrl.toString());
  }
}

