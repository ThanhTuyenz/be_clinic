import { Module } from '@nestjs/common';
import { SpecialtiesController } from './specialties.controller.js';
import { SpecialtiesService } from './specialties.service.js';
import { PackagesService } from './packages.service.js';
import { RedisModule } from '../../infrastructure/redis/redis.module.js';

@Module({
  imports: [RedisModule],
  controllers: [SpecialtiesController],
  providers: [SpecialtiesService, PackagesService],
  exports: [SpecialtiesService, PackagesService],
})
export class SpecialtiesModule {}
