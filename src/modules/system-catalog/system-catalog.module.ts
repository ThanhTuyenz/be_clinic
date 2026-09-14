import { Module } from '@nestjs/common'
import { RedisModule } from '../../infrastructure/cache/redis/redis.module.js'
import { RecommendationModule } from '../recommendations/recommendation.module.js'
import { SystemCatalogController } from './system-catalog.controller.js'
import { SystemCatalogService } from './system-catalog.service.js'

@Module({
  imports: [RedisModule, RecommendationModule],
  controllers: [SystemCatalogController],
  providers: [SystemCatalogService],
})
export class SystemCatalogModule {}

