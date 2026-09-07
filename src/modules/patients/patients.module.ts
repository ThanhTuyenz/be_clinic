import { Module } from '@nestjs/common';
import { PatientProfilesController } from './patient-profiles.controller.js';
import { PatientProfilesService } from './patient-profiles.service.js';
import { RecommendationModule } from '../recommendations/recommendation.module.js';

@Module({
  imports: [RecommendationModule],
  controllers: [PatientProfilesController],
  providers: [PatientProfilesService],
  exports: [PatientProfilesService],
})
export class PatientsModule {}
