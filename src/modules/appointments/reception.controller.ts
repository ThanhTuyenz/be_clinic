import { Controller, Get, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { SkipPermissions } from 'src/common/decorators';
import { StaffAppointmentsService } from './staff-appointments.service.js';

@ApiTags('Reception Desk Operations')
@ApiBearerAuth('access-token')
@Controller()
@SkipPermissions()
export class ReceptionController {
  constructor(private readonly staffAppointments: StaffAppointmentsService) {}

  @Get(['reception/summary', 'appointments/reception-summary'])
  @ApiOperation({ summary: 'Thẻ đếm ca khám & tiền két quầy thu ngân trong ca trực' })
  @ApiQuery({ name: 'date', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'branchId', required: false, description: 'UUID chi nhánh (hoặc "all")' })
  getSummary(
    @Req() request: Request,
    @Query('date') date?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.staffAppointments.getReceptionSummary(request.user!.id, { date, branchId });
  }
}
