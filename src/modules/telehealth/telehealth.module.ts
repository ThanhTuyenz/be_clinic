import { Module } from '@nestjs/common';
import { TelehealthGateway } from './telehealth.gateway.js';
import { TelehealthService } from './telehealth.service.js';
import { TelehealthController } from './telehealth.controller.js';
import { JwtAuthCoreModule } from '../auth/jwt-auth-core/jwt-auth-core.module.js';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [JwtAuthCoreModule, ConfigModule],
  controllers: [TelehealthController],
  providers: [TelehealthGateway, TelehealthService],
  exports: [TelehealthGateway, TelehealthService],
})
export class TelehealthModule {}
