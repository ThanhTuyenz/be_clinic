import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { RedisModule } from '../../infrastructure/redis/redis.module.js';
import { RecommendationModule } from '../recommendations/recommendation.module.js';
import { SearchModule } from '../search/search.module.js';
import { BranchesController } from './branches.controller.js';
import { BranchesService } from './branches.service.js';
import { SpecialtiesController } from './specialties.controller.js';
import { SpecialtiesService } from './specialties.service.js';
import { PackagesService } from './packages.service.js';
import { SystemCatalogController } from './system-catalog.controller.js';
import { SystemCatalogService } from './system-catalog.service.js';

@Module({
  imports: [PrismaModule, RedisModule, SearchModule, RecommendationModule],
  controllers: [BranchesController, SpecialtiesController, SystemCatalogController],
  providers: [BranchesService, SpecialtiesService, PackagesService, SystemCatalogService],
  exports: [BranchesService, SpecialtiesService, PackagesService],
})
export class CatalogModule {}
