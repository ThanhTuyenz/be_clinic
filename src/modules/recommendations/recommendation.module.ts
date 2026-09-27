import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { RedisModule } from '../../infrastructure/redis/redis.module.js';
import { EmbeddingModule } from '../../infrastructure/embedding/embedding.module.js';
import { RecommendationController } from './recommendation.controller.js';
import { RecommendationService } from './recommendation.service.js';

@Module({
  imports: [PrismaModule, RedisModule, EmbeddingModule],
  controllers: [RecommendationController],
  providers: [RecommendationService],
  exports: [RecommendationService, EmbeddingModule],
})
export class RecommendationModule {}
