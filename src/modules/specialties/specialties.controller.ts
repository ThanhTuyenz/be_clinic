import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import { SkipPermissions } from '../auth/permissions/decorators/skip-permissions.decorator.js';
import { SpecialtiesService } from './specialties.service.js';

@ApiTags('Specialties & Services')
@Public()
@SkipPermissions()
@Controller()
export class SpecialtiesController {
  constructor(private readonly svc: SpecialtiesService) {}

  /**
   * Danh sách chuyên khoa
   */
  @Get(['specialties', 'public/specialties'])
  @ApiOperation({ summary: 'Danh sách chuyên khoa' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Lọc theo chi nhánh' })
  getSpecialties(@Query('branchId') branchId?: string) {
    return this.svc.getSpecialties(branchId);
  }

  /**
   * Chi tiết chuyên khoa
   */
  @Get('specialties/:id')
  @ApiOperation({ summary: 'Chi tiết chuyên khoa' })
  @ApiParam({ name: 'id', type: 'integer' })
  getSpecialtyById(@Param('id', ParseIntPipe) id: number) {
    return this.svc.getSpecialtyById(id);
  }

  /**
   * Dịch vụ khám theo chuyên khoa
   */
  @Get(['specialties/services', 'public/specialty-services'])
  @ApiOperation({ summary: 'Dịch vụ khám theo chuyên khoa, có thể lọc theo chi nhánh' })
  getSpecialtyServicesQuery(
    @Query('branchId') branchId: string | undefined,
    @Query('specialtyId') specialtyId: string,
  ) {
    return this.svc.specialtyServices(branchId, Number(specialtyId));
  }

  /**
   * Gói khám / dịch vụ thuộc chuyên khoa theo ID
   */
  @Get('specialties/:id/services')
  @ApiOperation({ summary: 'Gói khám & dịch vụ theo chuyên khoa' })
  @ApiParam({ name: 'id', type: 'integer' })
  @ApiQuery({ name: 'branchId', required: false })
  getSpecialtyServices(
    @Param('id', ParseIntPipe) id: number,
    @Query('branchId') branchId?: string,
  ) {
    return this.svc.getSpecialtyServices(id, branchId);
  }

  /**
   * Bác sĩ thuộc chuyên khoa
   */
  @Get('specialties/:id/doctors')
  @ApiOperation({ summary: 'Bác sĩ theo chuyên khoa' })
  @ApiParam({ name: 'id', type: 'integer' })
  @ApiQuery({ name: 'branchId', required: false })
  @ApiQuery({ name: 'q', required: false, description: 'Tìm kiếm theo tên bác sĩ' })
  getSpecialtyDoctors(
    @Param('id', ParseIntPipe) id: number,
    @Query('branchId') branchId?: string,
    @Query('q') q?: string,
  ) {
    return this.svc.getSpecialtyDoctors(id, branchId, q);
  }

  /**
   * Danh sách gói khám chuyên khoa
   */
  @Get(['services/packages/specialty', 'public/specialty-packages'])
  @ApiOperation({ summary: 'Danh sách gói khám chuyên khoa' })
  @ApiQuery({ name: 'branchId', required: false })
  getSpecialtyPackages(@Query('branchId') branchId?: string) {
    return this.svc.specialtyPackages(branchId);
  }

  /**
   * Danh sách gói khám sức khỏe
   */
  @Get(['services/packages/health', 'public/health-packages'])
  @ApiOperation({ summary: 'Danh sách gói khám sức khỏe' })
  @ApiQuery({ name: 'branchId', required: false })
  getHealthPackages(@Query('branchId') branchId?: string) {
    return this.svc.healthPackages(branchId);
  }

  /**
   * Lịch khám của gói dịch vụ
   */
  @Get(['services/schedule-dates', 'public/service-package-schedule-dates'])
  @ApiOperation({ summary: 'Các ngày có lịch khám cho gói dịch vụ' })
  getServicePackageScheduleDates(
    @Query('packageId') packageId: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.svc.servicePackageScheduleDates(packageId, branchId);
  }

  /**
   * Khung giờ của gói dịch vụ
   */
  @Get(['services/timeslots', 'public/service-package-timeslots'])
  @ApiOperation({ summary: 'Khung giờ khám cho gói dịch vụ theo ngày' })
  getServicePackageTimeslots(
    @Query('packageId') packageId: string,
    @Query('date') date: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.svc.servicePackageTimeslots(packageId, date, branchId);
  }

  /**
   * Chi tiết gói dịch vụ / gói khám
   */
  @Get('services/:id')
  @ApiOperation({ summary: 'Chi tiết gói dịch vụ / gói khám' })
  @ApiParam({ name: 'id', format: 'uuid' })
  getServiceDetail(@Param('id') id: string) {
    return this.svc.getServiceDetail(id);
  }

  /**
   * Gói dịch vụ tổng quát
   */
  @Get('services')
  @ApiOperation({ summary: 'Gói dịch vụ tổng quát (health checkup)' })
  @ApiQuery({ name: 'branchId', required: false })
  @ApiQuery({ name: 'q', required: false })
  getGeneralServices(
    @Query('branchId') branchId?: string,
    @Query('q') q?: string,
  ) {
    return this.svc.getGeneralServices(branchId, q);
  }
}
