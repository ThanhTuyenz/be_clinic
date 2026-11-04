import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module.js';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { RedisModule } from '../../infrastructure/redis/redis.module.js';
import { EmbeddingModule } from '../../infrastructure/embedding/embedding.module.js';
import { RecommendationController } from './recommendation.controller.js';
import { RecommendationService } from './recommendation.service.js';
import { BehaviorTelemetryService } from './services/behavior-telemetry.service.js';
import { CandidateRetrievalService } from './services/candidate-retrieval.service.js';
import { AiRankingService } from './services/ai-ranking.service.js';

@Module({
  imports: [PrismaModule, RedisModule, EmbeddingModule, AnalyticsModule],
  controllers: [RecommendationController],
  providers: [
    RecommendationService,
    BehaviorTelemetryService,
    CandidateRetrievalService,
    AiRankingService,
  ],
  exports: [
    RecommendationService,
    BehaviorTelemetryService,
    EmbeddingModule,
  ],
})
export class RecommendationModule {}
