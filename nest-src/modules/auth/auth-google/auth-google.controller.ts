import { Controller, Inject, Get, UseGuards, Req } from '@nestjs/common';

import { Routes, Services } from 'src/common/utils/constants';
import { IAuthService } from '../auth-local/auth';
import { AuthProvidersEnum } from '../auth-local/enums/auth-providers.enum';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Public } from 'src/common/decorators/public.decorator';
import { SkipPermissions } from '../../permissions/decorators/skip-permissions.decorator';

@ApiTags('Auth')
@Public()
@SkipPermissions()
@Controller(Routes.AUTH)
export class AuthGoogleController {
  constructor(
    @Inject(Services.AUTH) private readonly authService: IAuthService,
  ) {}

  @Get('google/login')
  @UseGuards(AuthGuard('google'))
  async googleLogin() {
    // Initiates the Google OAuth2 authentication process
  }

  @Get('google/redirect')
  @UseGuards(AuthGuard('google'))
  async googleLoginCallback(@Req() req: any) {
    const user = await this.authService.validateSocialLogin(
      AuthProvidersEnum.google,
      {
        id: req.user.user.id,
        fullName: req.user.user.fullName,
        email: req.user.user.email,
      },
    );
    return user;
  }
}
