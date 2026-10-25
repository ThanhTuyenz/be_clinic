import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { SearchAnalyticsService } from './search-analytics.service.js';
import { SearchAnalyticsController } from './search-analytics.controller.js';

@Global()
@Module({ imports: [PrismaModule], controllers: [SearchAnalyticsController], providers: [SearchAnalyticsService], exports: [SearchAnalyticsService] })
export class SearchAnalyticsModule {}
