import { Controller, Get, Query, Req } from '@nestjs/common'
import type { Request } from 'express'
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { SkipPermissions } from '../permissions/decorators/skip-permissions.decorator.js'
import { DoctorDashboardService } from './doctor-dashboard.service.js'

@ApiTags('Doctor Consultation Desk')
@ApiBearerAuth('access-token')
@Controller('doctor')
@SkipPermissions()
export class DoctorDashboardController {
  constructor(private readonly service: DoctorDashboardService) {}

  @Get('queue-summary')
  @ApiOperation({ summary: 'Thống kê hàng đợi và tiến độ khám bệnh của Bác sĩ trong ngày' })
  @ApiQuery({ name: 'date', required: false, description: 'YYYY-MM-DD' })
  getQueueSummary(@Req() request: Request, @Query('date') date?: string) {
    return this.service.getQueueSummary(request.user!.id, date)
  }
}
