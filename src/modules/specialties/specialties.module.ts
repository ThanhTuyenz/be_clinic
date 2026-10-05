import { Module } from '@nestjs/common';
import { SpecialtiesController } from './specialties.controller.js';
import { SpecialtiesService } from './specialties.service.js';
import { PackagesService } from './packages.service.js';
import { PackageSchedulesService } from './package-schedules.service.js';
import { RedisModule } from '../../infrastructure/redis/redis.module.js';

@Module({
  imports: [RedisModule],
  controllers: [SpecialtiesController],
  providers: [SpecialtiesService, PackagesService, PackageSchedulesService],
  exports: [SpecialtiesService, PackagesService, PackageSchedulesService],
})
export class SpecialtiesModule {}
