import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Get,
  Query,
  BadRequestException,
  Req,
  UnauthorizedException,
  Res,
} from '@nestjs/common';
import { Request, Response, CookieOptions } from 'express';
import { Routes, Services } from 'src/common/utils/constants';
import { Public } from 'src/common/decorators/public.decorator';
import { IAuthService } from './auth';
import { AuthEmailLoginDto } from './dtos/auth-email-login.dto';
import { LoginResponseType } from './types/login-response.type';
import { AuthRegisterDto } from './dtos/auth-register.dto';
import { AuthConfirmEmailDto } from './dtos/auth-confirm-email.dto';
import { NullableType } from 'src/common/utils/types/nullable.type';
import { User } from '../users/entities/user.entity';
import { AuthForgotPasswordDto } from './dtos/auth-forgot-password.dto';
import { AuthResetPasswordDto } from './dtos/auth-reset-password.dto';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipPermissions } from '../../permissions/decorators/skip-permissions.decorator';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from 'src/config/config.type';
import { ttlToMilliseconds } from '../../../config/auth.config';
import {
  AuthResendOtpDto,
  AuthVerifyOtpDto,
} from './dtos/auth-verify-otp.dto';

@ApiTags('Auth')
@SkipPermissions() // Skip permissions check for all routes in this controller
@Controller(Routes.AUTH)
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    @Inject(Services.AUTH) private readonly authService: IAuthService,
    private readonly configService: ConfigService<AllConfigType>,
  ) { }

  private getCookieMaxAge(durationKey: 'auth.expires' | 'auth.refreshExpires'): number {
    const duration = this.configService.getOrThrow<string>(durationKey, {
      infer: true,
    });
    try {
      return ttlToMilliseconds(duration);
    } catch {
      throw new HttpException(
        'Invalid auth cookie expiration duration',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('check-email')
  @Public()
  @HttpCode(HttpStatus.OK)
  async checkEmail(@Query('email') email: string) {

    if (!email) {
      throw new BadRequestException('Email không được để trống');
    }
    const isValid = await this.authService.checkEmail(email);
    return { isValid };
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: AuthEmailLoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseType> {
    const response = await this.authService.validateLogin(loginDto);

    const isProduction = process.env.NODE_ENV === 'production';

    const cookieOptions: CookieOptions = {
      httpOnly: true,
      secure: isProduction,
      sameSite: false, // Allow cookies in cross-origin POST requests
      path: '/',
    };

    const tokenMaxAge = this.getCookieMaxAge('auth.expires');
    const refreshTokenMaxAge = this.getCookieMaxAge('auth.refreshExpires');

    // Set accessToken vào cookie
    res.cookie('token', response.token, {
      ...cookieOptions,
      maxAge: tokenMaxAge,
    });

    // Set refreshToken vào cookie
    res.cookie('refreshToken', response.refreshToken, {
      ...cookieOptions,
      maxAge: refreshTokenMaxAge,
    });

    return response;
  }

  @Post('register')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Đăng ký và gửi OTP xác thực email' })
  async register(@Body() createUserDto: AuthRegisterDto): Promise<void> {

    return await this.authService.registerUser(createUserDto);
  }

  @Post('verify-otp')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Xác thực OTP và kích hoạt tài khoản' })
  verifyOtp(@Body() dto: AuthVerifyOtpDto): Promise<void> {
    return this.authService.verifyRegistrationOtp(dto.email, dto.otp);
  }

  @Post('resend-otp')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Gửi lại OTP xác thực email' })
  resendOtp(@Body() dto: AuthResendOtpDto): Promise<void> {
    return this.authService.resendRegistrationOtp(dto.email);
  }

  @Post('confirm-email')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  async confirmEmail(
    @Body() confirmEmailDto: AuthConfirmEmailDto,
  ): Promise<void> {
    return this.authService.confirmEmail(confirmEmailDto.hash);
  }

  @Get('confirm-email')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  async confirmEmailByHash(@Query('hash') hash: string): Promise<void> {
    if (!hash) {
      throw new BadRequestException('Hash không được để trống');
    }

    return this.authService.confirmEmail(hash);
  }

  @ApiBearerAuth('access-token')
  @Get('status')
  @HttpCode(HttpStatus.OK)
  public status(@Req() request): Promise<NullableType<User>> {
    return this.authService.status(request.user);
  }

  @Post('forgot-password')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  async forgotPassword(
    @Body() forgotPasswordDto: AuthForgotPasswordDto,
  ): Promise<void> {
    return this.authService.forgotPassword(forgotPasswordDto.email);
  }

  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  resetPassword(@Body() resetPasswordDto: AuthResetPasswordDto): Promise<void> {
    return this.authService.resetPassword(
      resetPasswordDto.hash,
      resetPasswordDto.password,
    );
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  public async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body('refreshToken') bodyRefreshToken?: string,
  ): Promise<Omit<LoginResponseType, 'user'>> {
    // Try cookie first, fallback to body
    let refreshToken = req.cookies?.refreshToken;

    if (!refreshToken && bodyRefreshToken) {
      refreshToken = bodyRefreshToken;
    }

    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token không tồn tại');
    }

    this.logger.log('Refresh request accepted');

    const response =
      await this.authService.refreshTokenFromCookie(refreshToken);

    this.logger.log(
      `Refresh response issued, hasToken=${Boolean(response.token)}, hasRefreshToken=${Boolean(response.refreshToken)}`,
    );

    const isProduction = process.env.NODE_ENV === 'production';
    const tokenMaxAge = this.getCookieMaxAge('auth.expires');
    const refreshTokenMaxAge = this.getCookieMaxAge('auth.refreshExpires');

    // Set accessToken vào cookie
    const refreshCookieOptions: CookieOptions = {
      httpOnly: true,
      secure: isProduction,
      sameSite: false, // Allow cookies in cross-origin POST requests
      maxAge: tokenMaxAge,
      path: '/',
    };
    res.cookie('token', response.token, refreshCookieOptions);
    // Refresh token được rotate sau mỗi lần sử dụng, vì vậy cookie
    // cũ phải được thay thế cùng response.
    res.cookie('refreshToken', response.refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: false,
      maxAge: refreshTokenMaxAge,
      path: '/',
    });

    return {
      token: response.token,
      tokenExpires: response.tokenExpires,
      refreshToken: response.refreshToken,
    };
  }

  @ApiBearerAuth('access-token')
  @Post('logout')
  @SkipPermissions()
  @HttpCode(HttpStatus.NO_CONTENT)
  public async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.logout({
      sessionId: (request as Request & { user?: { sessionId?: string } }).user!.sessionId!,
    });

    const isProduction = process.env.NODE_ENV === 'production';

    const cookieOptions: CookieOptions = {
      httpOnly: true,
      secure: isProduction,
      sameSite: false,
      path: '/',
    };

    // Clear cả 2 cookies
    res.clearCookie('token', cookieOptions);
    res.clearCookie('refreshToken', cookieOptions);
  }
}
