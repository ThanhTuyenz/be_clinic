import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { RedisModule } from '../../infrastructure/redis/redis.module.js';
import { EmbeddingModule } from '../../infrastructure/embedding/embedding.module.js';
import { RecommendationModule } from '../recommendations/recommendation.module.js';
import { SearchController, LegacySearchController } from './search.controller.js';
import { SearchService } from './services/search.service.js';
import { SearchRankingService } from './services/search-ranking.service.js';

@Module({
  imports: [PrismaModule, RedisModule, EmbeddingModule, RecommendationModule],
  controllers: [SearchController, LegacySearchController],
  providers: [SearchService, SearchRankingService],
  exports: [SearchRankingService],
})
export class SearchModule {}
