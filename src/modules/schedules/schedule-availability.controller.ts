import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AppPermission } from '../../common/constants/permissions.constant.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { SkipPermissions } from '../../common/decorators/skip-permissions.decorator.js';
import { ScheduleAvailabilityService } from './schedule-availability.service.js';
import { ReceptionAvailabilityQueryDto } from '../bookings/dtos/reception-booking.dto.js';

@ApiTags('ScheduleAvailability')
@ApiBearerAuth('access-token')
@Controller('schedules')
@SkipPermissions()
export class ScheduleAvailabilityController {
  constructor(private readonly schedules: ScheduleAvailabilityService) {}

  @Get('availability')
  @ApiOperation({ summary: 'Lấy ngày, khung giờ và bác sĩ còn chỗ để đặt khám tại quầy' })
  @ApiQuery({ name: 'doctorId', required: false })
  @ApiQuery({ name: 'date', example: '2026-08-10' })
  @ApiQuery({ name: 'startTime', required: false, example: '10:00', description: 'Lọc bác sĩ còn chỗ trong khung giờ đã chọn' })
  @ApiQuery({ name: 'specialtyId', required: false, type: Number })
  @ApiQuery({ name: 'servicePackageId', required: false })
  @ApiQuery({ name: 'branchId', required: false })
  getAvailability(@Req() req: Request, @Query() query: ReceptionAvailabilityQueryDto) {
    return this.schedules.availability(req.user!.id, query.doctorId, query.date, query);
  }

  @Post('doctor-leave/impact-analysis')
  @RequirePermissions(AppPermission.SCHEDULE_UPDATE)
  @ApiOperation({ summary: 'Phân tích ảnh hưởng khi bác sĩ nghỉ phép' })
  doctorLeaveImpact(
    @Req() request: Request,
    @Body() body: { doctorId: string; fromDate: string; toDate: string },
  ) {
    return this.schedules.doctorLeaveImpactAnalysis(request.user!.id, body);
  }
}
