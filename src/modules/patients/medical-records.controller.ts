import { Controller, Get, Param, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SkipPermissions } from '../permissions/decorators/skip-permissions.decorator.js';
import { PatientProfilesService } from './patient-profiles.service.js';

@ApiTags('Medical records')
@ApiBearerAuth('access-token')
@Controller('medical-records')
@SkipPermissions()
export class MedicalRecordsController {
  constructor(private readonly service: PatientProfilesService) {}

  @Get(':patientProfileId')
  @ApiOperation({ summary: 'Lấy thông tin bệnh án và lịch sử các ca khám của hồ sơ bệnh nhân' })
  getMedicalRecord(@Req() request: Request, @Param('patientProfileId') patientProfileId: string) {
    return this.service.getMedicalRecord(request.user!.id, patientProfileId);
  }
}
