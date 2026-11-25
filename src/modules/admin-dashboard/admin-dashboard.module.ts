import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { RedisModule } from '../../infrastructure/redis/redis.module.js'
import { AdminDashboardController } from './admin-dashboard.controller.js'
import { AdminDashboardService } from './admin-dashboard.service.js'

import { ReceptionSummaryService } from './reception-summary.service.js'
import { IntegrationsController } from './integrations/integrations.controller.js'
import { IntegrationsService } from './integrations/integrations.service.js'

@Module({
  imports: [RedisModule, ConfigModule],
  controllers: [
    AdminDashboardController,
    IntegrationsController,
  ],
  providers: [
    ReceptionSummaryService,
    IntegrationsService,
    AdminDashboardService,
  ],
  exports: [
    AdminDashboardService,
  ],
})
export class AdminDashboardModule {}

