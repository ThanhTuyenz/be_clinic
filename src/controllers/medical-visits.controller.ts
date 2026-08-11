import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common'
import type { Request } from 'express'
import { SkipPermissions } from '../modules/permissions/decorators/skip-permissions.decorator.js'
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger'
import { MedicalVisitsService } from '../modules/medical-visits/medical-visits.service.js'

@ApiTags('Medical visits')
@ApiBearerAuth('access-token')
@Controller('medical-visits')
@SkipPermissions()
export class MedicalVisitsController {
  constructor(private readonly medicalVisits: MedicalVisitsService) {}

  @Get()
  @ApiOperation({ summary: 'Lấy hồ sơ lần khám theo lịch hẹn' })
  findOne(@Req() req: Request, @Query('appointmentId') appointmentId: string) {
    return this.medicalVisits.findByAppointment(req.user!.id, appointmentId)
  }

  @Post()
  @ApiOperation({ summary: 'Tạo hoặc cập nhật hồ sơ lần khám' })
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  upsertMedicalVisit(@Req() req: Request, @Body() body: Record<string, unknown>) {
    return this.medicalVisits.upsert(req.user!.id, body)
  }
}
