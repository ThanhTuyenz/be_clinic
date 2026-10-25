import { Module } from '@nestjs/common';
import { AuthGoogleService } from './auth-google.service';
import { AuthGoogleController } from './auth-google.controller';
import { AuthModule } from '../auth-local/auth.module';
import { ConfigModule } from '@nestjs/config';
import { GoogleStrategy } from './strategies/google.strategy';
import { PassportModule } from '@nestjs/passport';

@Module({
  imports: [AuthModule, ConfigModule, PassportModule],
  providers: [GoogleStrategy, AuthGoogleService],
  controllers: [AuthGoogleController],
})
export class AuthGoogleModule {}
