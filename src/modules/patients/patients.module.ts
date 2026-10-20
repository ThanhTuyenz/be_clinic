import { Module } from '@nestjs/common';
import { RecommendationModule } from '../recommendations/recommendation.module.js';
import { PatientProfilesController } from './patient-profiles.controller.js';
import { PatientProfilesService } from './patient-profiles.service.js';

import { PatientDirectoryController } from './patient-directory.controller.js';
import { PatientDirectoryService } from './patient-directory.service.js';

@Module({
  imports: [RecommendationModule],
  controllers: [PatientProfilesController, PatientDirectoryController],
  providers: [PatientProfilesService, PatientDirectoryService],
  exports: [PatientProfilesService, PatientDirectoryService],
})
export class PatientsModule {}
