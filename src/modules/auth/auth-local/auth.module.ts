import { Module } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { Services } from '../../../common/utils/constants.js';
import { UsersModule } from '../users/users.module.js';
import { SessionModule } from '../session/session.module.js';
import { MailsModule } from '../../../infrastructure/mail/mails.module.js';
import { HistoryModule } from '../history/history.module.js';
import { AuthOtpService } from './services/auth-otp.service.js';
import { AuthTokenService } from './services/auth-token.service.js';
import { PasswordResetService } from './services/password-reset.service.js';

@Module({
  imports: [
    UsersModule,
    SessionModule,
    MailsModule,
    HistoryModule,
  ],

  controllers: [AuthController],
  providers: [
    AuthOtpService,
    AuthTokenService,
    PasswordResetService,
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
