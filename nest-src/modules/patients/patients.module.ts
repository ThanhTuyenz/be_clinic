import { Module } from '@nestjs/common';
import { PatientProfilesController } from './patient-profiles.controller.js';
import { PatientProfilesService } from './patient-profiles.service.js';

@Module({ controllers: [PatientProfilesController], providers: [PatientProfilesService] })
export class PatientsModule {}
