import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module.js';
import { EmbeddingService } from './embedding.service.js';

@Module({
  imports: [RedisModule],
  providers: [EmbeddingService],
  exports: [EmbeddingService],
})
export class EmbeddingModule {}
