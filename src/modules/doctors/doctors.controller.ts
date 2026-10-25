import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { SkipPermissions } from 'src/common/decorators';
import { DoctorsService } from './doctors.service.js';

@ApiTags('Doctors')
@Controller(['doctors', 'doctor'])
@SkipPermissions()
export class DoctorsController {
  constructor(private readonly doctorsService: DoctorsService) { }

  @ApiBearerAuth('access-token')
  @Get('queue-summary')
  @ApiOperation({ summary: 'Thống kê hàng đợi và tiến độ khám bệnh của Bác sĩ trong ngày' })
  @ApiQuery({ name: 'date', required: false, description: 'YYYY-MM-DD' })
  queueSummary(@Req() request: Request, @Query('date') date?: string) {
    return this.doctorsService.getQueueSummary(request.user!.id, date);
  }

  @Public()

  @Get()
  @ApiOperation({ summary: 'Danh sách bác sĩ theo cơ sở/chuyên khoa' })
  @ApiQuery({ name: 'branchId', required: false })
  @ApiQuery({ name: 'departmentId', required: false, type: Number })
  @ApiQuery({ name: 'specialtyId', required: false, type: Number })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'featuredOnly', required: false, type: Boolean })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'onlineOnly', required: false, type: Boolean })
  doctors(
    @Query('branchId') branchId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('specialtyId') specialtyId?: string,
    @Query('q') q?: string,
    @Query('featuredOnly') featuredOnly?: string,
    @Query('limit') limit?: string,
    @Query('onlineOnly') onlineOnly?: string,
  ) {
    return this.doctorsService.doctors(
      branchId,
      departmentId ? Number(departmentId) : undefined,
      specialtyId ? Number(specialtyId) : undefined,
      q,
      featuredOnly === 'true',
      limit ? Number(limit) : undefined,
      onlineOnly === 'true',
    );
  }

  @Public()
  @Get(':doctorId/available-dates')
  @ApiOperation({ summary: 'Các ngày bác sĩ còn khung giờ khả dụng' })
  @ApiQuery({ name: 'branchId' })
  availableDates(@Param('doctorId') doctorId: string, @Query('branchId') branchId: string) {
    return this.doctorsService.availableDates(doctorId, branchId);
  }

  @Public()
  @Get(':doctorId/timeslots')
  @ApiOperation({ summary: 'Khung giờ và số chỗ còn lại theo ngày' })
  @ApiQuery({ name: 'branchId' })
  @ApiQuery({ name: 'date', example: '2026-08-10' })
  timeslots(
    @Param('doctorId') doctorId: string,
    @Query('branchId') branchId: string,
    @Query('date') date: string,
  ) {
    return this.doctorsService.timeslots(doctorId, branchId, date);
  }
}
