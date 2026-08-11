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
import { MailsModule } from '../../mails/mails.module';
import { ForgotPasswordModule } from '../forgot-password/forgot-password.module';
import { HistoryModule } from '../../history/history.module';

@Module({
  imports: [
    UsersModule,
    SessionModule,
    MailsModule,
    PassportModule,
    ForgotPasswordModule,
    HistoryModule,
  ],

  controllers: [AuthController],
  providers: [
    JwtRefreshStrategy,
    JwtStrategy,
    AnonymousStrategy,
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
