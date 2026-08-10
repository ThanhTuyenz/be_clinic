import { Body, Controller, Get, Param, Patch, Req } from '@nestjs/common'
import type { Request } from 'express'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { SkipPermissions } from '../permissions/decorators/skip-permissions.decorator.js'
import { UpdateMedicalRecordDto } from './dtos/update-medical-record.dto.js'
import { MedicalRecordsService } from './medical-records.service.js'

@ApiTags('Medical records')
@ApiBearerAuth('access-token')
@Controller('medical-records')
@SkipPermissions()
export class MedicalRecordsController {
  constructor(private readonly medicalRecords: MedicalRecordsService) {}

  @Get(':patientProfileId')
  @ApiOperation({ summary: 'Xem hồ sơ bệnh án tổng thể và các lần khám' })
  findByPatient(@Req() request: Request, @Param('patientProfileId') patientProfileId: string) {
    return this.medicalRecords.findByPatient(request.user!.id, patientProfileId)
  }

  @Patch(':patientProfileId')
  @ApiOperation({ summary: 'Cập nhật tiền sử và thông tin bệnh án tổng thể' })
  update(
    @Req() request: Request,
    @Param('patientProfileId') patientProfileId: string,
    @Body() input: UpdateMedicalRecordDto,
  ) {
    return this.medicalRecords.update(request.user!.id, patientProfileId, input)
  }
}
