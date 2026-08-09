import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { DirectoryService } from '../modules/doctors/directory.service.js';

@Public()
@ApiTags('Branches')
@Controller('branches')
export class BranchesController {
  constructor(private readonly directory: DirectoryService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách cơ sở đang hoạt động' })
  branches() { return this.directory.branches(); }

  @Get(':branchId/departments')
  @ApiOperation({ summary: 'Chuyên khoa có bác sĩ tại cơ sở' })
  departments(@Param('branchId') branchId: string) { return this.directory.departments(branchId); }
}

@Public()
@ApiTags('Doctors')
@Controller('doctors')
export class DoctorsController {
  constructor(private readonly directory: DirectoryService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách bác sĩ theo cơ sở/chuyên khoa' })
  @ApiQuery({ name: 'branchId', required: false })
  @ApiQuery({ name: 'departmentId', required: false, type: Number })
  doctors(@Query('branchId') branchId?: string, @Query('departmentId') departmentId?: string) {
    return this.directory.doctors(branchId, departmentId ? Number(departmentId) : undefined);
  }

  @Get(':doctorId/available-dates')
  @ApiOperation({ summary: 'Các ngày bác sĩ còn khung giờ khả dụng' })
  @ApiQuery({ name: 'branchId' })
  availableDates(@Param('doctorId') doctorId: string, @Query('branchId') branchId: string) {
    return this.directory.availableDates(doctorId, branchId);
  }

  @Get(':doctorId/timeslots')
  @ApiOperation({ summary: 'Khung giờ và số chỗ còn lại theo ngày' })
  @ApiQuery({ name: 'branchId' })
  @ApiQuery({ name: 'date', example: '2026-08-10' })
  timeslots(@Param('doctorId') doctorId: string, @Query('branchId') branchId: string, @Query('date') date: string) {
    return this.directory.timeslots(doctorId, branchId, date);
  }
}
