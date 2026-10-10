import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { AllConfigType } from '../../../config/config.type.js';
import { UsersModule } from '../users/users.module.js';

import { TokenBlacklistService } from './token-blacklist.service.js';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService<AllConfigType>) => ({
        secret: configService.getOrThrow('auth', { infer: true }).secret,
        signOptions: {
          expiresIn: configService.getOrThrow('auth', { infer: true })
            .expires as never,
        },
      }),
      inject: [ConfigService],
    }),
    UsersModule,
  ],
  providers: [JwtAuthGuard, TokenBlacklistService],
  exports: [JwtModule, JwtAuthGuard, UsersModule, TokenBlacklistService],
})
export class JwtAuthCoreModule {}
