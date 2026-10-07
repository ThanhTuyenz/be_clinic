import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import { SkipPermissions } from '../auth/permissions/decorators/skip-permissions.decorator.js';
import { SpecialtiesService } from './specialties.service.js';
import { PackagesService } from './packages.service.js';
import { PackageSchedulesService } from './package-schedules.service.js';

@ApiTags('Specialties & Services')
@Public()
@SkipPermissions()
@Controller()
export class SpecialtiesController {
  constructor(
    private readonly specialtiesService: SpecialtiesService,
    private readonly packagesService: PackagesService,
    private readonly packageSchedulesService: PackageSchedulesService,
  ) {}

  /**
   * Menu điều hướng công khai (BFF)
   */
  @Get('public/navigation')
  @ApiOperation({ summary: 'Menu điều hướng công khai (BFF)' })
  getNavigation() {
    return this.specialtiesService.getNavigation();
  }

  /**
   * Tổng hợp trang chủ công khai (BFF)
   */
  @Get('public/homepage')
  @ApiOperation({ summary: 'Tổng hợp trang chủ công khai (BFF)' })
  @ApiQuery({ name: 'branchId', required: false })
  getHomepage(@Query('branchId') branchId?: string) {
    return this.specialtiesService.getHomepage(branchId);
  }

  /**
   * Danh sách chuyên khoa
   */
  @Get(['specialties', 'public/specialties'])
  @ApiOperation({ summary: 'Danh sách chuyên khoa' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Lọc theo chi nhánh' })
  getSpecialties(@Query('branchId') branchId?: string) {
    return this.specialtiesService.getSpecialties(branchId);
  }

  /**
   * Dịch vụ khám theo chuyên khoa
   */
  @Get(['specialties/services', 'public/specialty-services'])
  @ApiOperation({ summary: 'Dịch vụ khám theo chuyên khoa, có thể lọc theo chi nhánh' })
  @ApiQuery({ name: 'specialtyId', required: true, type: 'integer' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Lọc theo chi nhánh' })
  getSpecialtyServicesQuery(
    @Query('branchId') branchId: string | undefined,
    @Query('specialtyId') specialtyId: string,
  ) {
    return this.specialtiesService.specialtyServices(branchId, Number(specialtyId));
  }

  /**
   * Chi tiết chuyên khoa
   */
  @Get('specialties/:id')
  @ApiOperation({ summary: 'Chi tiết chuyên khoa' })
  @ApiParam({ name: 'id', type: 'integer' })
  getSpecialtyById(@Param('id', ParseIntPipe) id: number) {
    return this.specialtiesService.getSpecialtyById(id);
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
    return this.specialtiesService.getSpecialtyServices(id, branchId);
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
    return this.specialtiesService.getSpecialtyDoctors(id, branchId, q);
  }

  /**
   * Danh sách gói khám tổng hợp phân trang và có cache Page 1
   */
  @Get(['services/packages', 'public/packages'])
  @ApiOperation({ summary: 'Danh sách gói khám tổng hợp phân trang (Offset) và cache Page 1' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'branchId', required: false, type: String })
  @ApiQuery({ name: 'specialtyId', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'minPrice', required: false, type: Number })
  @ApiQuery({ name: 'maxPrice', required: false, type: Number })
  @ApiQuery({ name: 'sortBy', required: false, type: String })
  @ApiQuery({ name: 'type', required: false, enum: ['all', 'health-package', 'specialty'] })
  @ApiQuery({ name: 'needPagination', required: false, type: Boolean })
  getPublicPackages(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('branchId') branchId?: string,
    @Query('specialtyId') specialtyId?: number,
    @Query('search') search?: string,
    @Query('minPrice') minPrice?: number,
    @Query('maxPrice') maxPrice?: number,
    @Query('sortBy') sortBy?: string,
    @Query('type') type?: 'all' | 'health-package' | 'specialty',
    @Query('needPagination') needPagination?: string | boolean,
  ) {
    const isNeedPagination = needPagination === false || needPagination === 'false' ? false : true;
    return this.packagesService.getPackages({
      page,
      limit,
      branchId,
      specialtyId,
      search,
      minPrice,
      maxPrice,
      sortBy,
      type,
      needPagination: isNeedPagination,
    });
  }

  /**
   * Danh sách gói khám chuyên khoa
   */
  @Get(['services/packages/specialty', 'public/specialty-packages'])
  @ApiOperation({ summary: 'Danh sách gói khám chuyên khoa' })
  @ApiQuery({ name: 'branchId', required: false })
  getSpecialtyPackages(@Query('branchId') branchId?: string) {
    return this.packagesService.specialtyPackages(branchId);
  }

  /**
   * Danh sách gói khám sức khỏe
   */
  @Get(['services/packages/health', 'public/health-packages'])
  @ApiOperation({ summary: 'Danh sách gói khám sức khỏe' })
  @ApiQuery({ name: 'branchId', required: false })
  getHealthPackages(@Query('branchId') branchId?: string) {
    return this.packagesService.healthPackages(branchId);
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
    return this.packageSchedulesService.getPackageScheduleDates(packageId, branchId);
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
    return this.packageSchedulesService.getPackageTimeslots(packageId, date, branchId);
  }

  /**
   * Chi tiết gói dịch vụ / gói khám (hỗ trợ ID UUID, mã code hoặc slug)
   */
  @Get(['services/:id', 'public/services/:id', 'public/packages/:id'])
  @ApiOperation({ summary: 'Chi tiết gói dịch vụ / gói khám theo ID/Slug/Code' })
  @ApiParam({ name: 'id', description: 'UUID, mã Code hoặc Slug của gói khám' })
  getServiceDetail(@Param('id') id: string) {
    return this.packagesService.getServiceDetail(id);
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
    return this.packagesService.getGeneralServices(branchId, q);
  }
}
