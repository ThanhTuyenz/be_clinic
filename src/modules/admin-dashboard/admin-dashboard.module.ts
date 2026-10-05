import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { RedisModule } from '../../infrastructure/redis/redis.module.js'
import { AdminDashboardController } from './admin-dashboard.controller.js'
import { AdminDashboardService } from './admin-dashboard.service.js'

import { TelemetrySyncTask } from './telemetry-sync.task.js'

@Module({
  imports: [RedisModule, ConfigModule],
  controllers: [
    AdminDashboardController,
  ],
  providers: [
    AdminDashboardService,
    TelemetrySyncTask,
  ],
  exports: [
    AdminDashboardService,
    TelemetrySyncTask,
  ],
})
export class AdminDashboardModule {}

