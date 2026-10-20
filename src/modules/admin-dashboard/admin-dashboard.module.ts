import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { RedisModule } from '../../infrastructure/redis/redis.module.js'
import { AdminDashboardController } from './admin-dashboard.controller.js'
import { AdminDashboardService } from './admin-dashboard.service.js'

import { TelemetrySyncTask } from './telemetry-sync.task.js'

import { ReceptionSummaryService } from './reception-summary.service.js'

@Module({
  imports: [RedisModule, ConfigModule],
  controllers: [
    AdminDashboardController,
  ],
  providers: [
    ReceptionSummaryService,
    AdminDashboardService,
    TelemetrySyncTask,
  ],
  exports: [
    AdminDashboardService,
    TelemetrySyncTask,
  ],
})
export class AdminDashboardModule {}

