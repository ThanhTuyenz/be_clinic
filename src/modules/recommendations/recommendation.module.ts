import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { RedisModule } from '../../infrastructure/redis/redis.module.js';
import { EmbeddingModule } from '../../infrastructure/embedding/embedding.module.js';
import { RecommendationController } from './recommendation.controller.js';
import { RecommendationService } from './recommendation.service.js';
import { BehaviorTelemetryService } from './services/behavior-telemetry.service.js';
import { CandidateRetrievalService } from './services/candidate-retrieval.service.js';
import { AiRankingService } from './services/ai-ranking.service.js';
import { SemanticSearchService } from './services/semantic-search.service.js';

@Module({
  imports: [PrismaModule, RedisModule, EmbeddingModule],
  controllers: [RecommendationController],
  providers: [
    RecommendationService,
    BehaviorTelemetryService,
    CandidateRetrievalService,
    AiRankingService,
    SemanticSearchService,
  ],
  exports: [
    RecommendationService,
    BehaviorTelemetryService,
    CandidateRetrievalService,
    AiRankingService,
    SemanticSearchService,
    EmbeddingModule,
  ],
})
export class RecommendationModule {}
