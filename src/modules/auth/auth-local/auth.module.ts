import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { Services } from 'src/common/utils/constants';
import { UsersModule } from '../users/users.module';
import { SessionModule } from '../session/session.module';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { AnonymousStrategy } from './strategies/anonymous.strategy';
import { MailsModule } from '../../../infrastructure/mail/mails.module.js';
import { ForgotPasswordModule } from '../forgot-password/forgot-password.module';
import { HistoryModule } from '../history/history.module.js';
import { ZaloZnsModule } from '../../../infrastructure/zalo-zns/zalo-zns.module.js';
import { AuthOtpService } from './services/auth-otp.service.js';
import { AuthTokenService } from './services/auth-token.service.js';
import { AccountLinkingService } from './services/account-linking.service.js';

@Module({
  imports: [
    UsersModule,
    SessionModule,
    MailsModule,
    PassportModule,
    ForgotPasswordModule,
    HistoryModule,
    ZaloZnsModule,
  ],

  controllers: [AuthController],
  providers: [
    JwtRefreshStrategy,
    JwtStrategy,
    AnonymousStrategy,
    // Sub-services
    AuthOtpService,
    AuthTokenService,
    AccountLinkingService,
    {
      provide: Services.AUTH,
      useClass: AuthService,
    },
  ],
  exports: [
    {
      provide: Services.AUTH,
      useClass: AuthService,
    },
  ],
})
export class AuthModule {}
