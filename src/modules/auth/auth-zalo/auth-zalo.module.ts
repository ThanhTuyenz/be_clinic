import { Module } from '@nestjs/common';
import { AuthZaloService } from './auth-zalo.service';
import { AuthZaloController } from './auth-zalo.controller';
import { AuthModule } from '../auth-local/auth.module';
import { ConfigModule } from '@nestjs/config';
import { Services } from '../../../common/utils/constants';

@Module({
  imports: [AuthModule, ConfigModule],
  providers: [
    {
      provide: Services.AUTH_ZALO,
      useClass: AuthZaloService,
    },
  ],
  exports: [
    {
      provide: Services.AUTH_ZALO,
      useClass: AuthZaloService,
    },
  ],
  controllers: [AuthZaloController],
})
export class AuthZaloModule {}
