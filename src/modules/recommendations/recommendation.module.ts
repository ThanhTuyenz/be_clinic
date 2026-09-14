import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { RedisModule } from '../../infrastructure/cache/redis/redis.module.js';
import { RecommendationController } from './recommendation.controller.js';
import { RecommendationService } from './recommendation.service.js';
import { EmbeddingService } from './embedding.service.js';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [RecommendationController],
  providers: [RecommendationService, EmbeddingService],
  exports: [RecommendationService, EmbeddingService],
})
export class RecommendationModule {}
