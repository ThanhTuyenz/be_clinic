import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { RedisModule } from '../../infrastructure/redis/redis.module.js'
import { AdminDashboardController } from './admin-dashboard.controller.js'
import { AdminDashboardService } from './admin-dashboard.service.js'

import { TelemetrySyncTask } from './telemetry-sync.task.js'

import { ReceptionSummaryService } from './reception-summary.service.js'
import { IntegrationsController } from './integrations/integrations.controller.js'
import { IntegrationsService } from './integrations/integrations.service.js'
import { RecommendationMetricsController } from './analytics/recommendation-metrics.controller.js'
import { RecommendationMetricsService } from './analytics/recommendation-metrics.service.js'

@Module({
  imports: [RedisModule, ConfigModule],
  controllers: [
    AdminDashboardController,
    IntegrationsController,
    RecommendationMetricsController,
  ],
  providers: [
    ReceptionSummaryService,
    IntegrationsService,
    RecommendationMetricsService,
    AdminDashboardService,
    TelemetrySyncTask,
  ],
  exports: [
    AdminDashboardService,
    TelemetrySyncTask,
  ],
})
export class AdminDashboardModule {}

