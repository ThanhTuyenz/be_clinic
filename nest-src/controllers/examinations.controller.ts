import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common'
import type { Request } from 'express'
import { SkipPermissions } from '../modules/permissions/decorators/skip-permissions.decorator.js'
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ExaminationsService } from '../modules/examinations/examinations.service.js'

@ApiTags('Examinations')
@ApiBearerAuth('access-token')
@Controller('examinations')
@SkipPermissions()
export class ExaminationsController {
  constructor(private readonly examinations: ExaminationsService) {}

  @Get()
  @ApiOperation({ summary: 'Lấy hồ sơ khám theo lịch hẹn' })
  findOne(@Req() req: Request, @Query('appointmentId') appointmentId: string) {
    return this.examinations.findByAppointment(req.user!.id, appointmentId)
  }

  @Post()
  @ApiOperation({ summary: 'Tạo hoặc cập nhật hồ sơ khám bệnh' })
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  upsertExamination(@Req() req: Request, @Body() body: Record<string, unknown>) {
    return this.examinations.upsert(req.user!.id, body)
  }
}
