import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common'
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger'
import { Public } from '../../common/decorators/public.decorator.js'
import { SkipPermissions } from '../permissions/decorators/skip-permissions.decorator.js'
import { SpecialtiesService } from './specialties.service.js'

@ApiTags('Specialties & Services')
@Public()
@SkipPermissions()
@Controller()
export class SpecialtiesController {
  constructor(private readonly svc: SpecialtiesService) {}

  /**
   * GET /specialties
   * Danh sách chuyên khoa (tuỳ chọn lọc theo chi nhánh)
   */
  @Get('specialties')
  @ApiOperation({ summary: 'Danh sách chuyên khoa' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Lọc theo chi nhánh' })
  getSpecialties(@Query('branchId') branchId?: string) {
    return this.svc.getSpecialties(branchId)
  }

  /**
   * GET /specialties/:id
   */
  @Get('specialties/:id')
  @ApiOperation({ summary: 'Chi tiết chuyên khoa' })
  @ApiParam({ name: 'id', type: 'integer' })
  getSpecialtyById(@Param('id', ParseIntPipe) id: number) {
    return this.svc.getSpecialtyById(id)
  }

  /**
   * GET /specialties/:id/services
   * Gói khám / dịch vụ thuộc chuyên khoa
   */
  @Get('specialties/:id/services')
  @ApiOperation({ summary: 'Gói khám & dịch vụ theo chuyên khoa' })
  @ApiParam({ name: 'id', type: 'integer' })
  @ApiQuery({ name: 'branchId', required: false })
  getSpecialtyServices(
    @Param('id', ParseIntPipe) id: number,
    @Query('branchId') branchId?: string,
  ) {
    return this.svc.getSpecialtyServices(id, branchId)
  }

  /**
   * GET /specialties/:id/doctors
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
    return this.svc.getSpecialtyDoctors(id, branchId, q)
  }

  /**
   * GET /services/:id
   * Chi tiết gói dịch vụ / gói khám
   */
  @Get('services/:id')
  @ApiOperation({ summary: 'Chi tiết gói dịch vụ / gói khám' })
  @ApiParam({ name: 'id', format: 'uuid' })
  getServiceDetail(@Param('id') id: string) {
    return this.svc.getServiceDetail(id)
  }

  /**
   * GET /services
   * Gói tổng quát (không thuộc chuyên khoa cụ thể)
   */
  @Get('services')
  @ApiOperation({ summary: 'Gói dịch vụ tổng quát (health checkup)' })
  @ApiQuery({ name: 'branchId', required: false })
  @ApiQuery({ name: 'q', required: false })
  getGeneralServices(
    @Query('branchId') branchId?: string,
    @Query('q') q?: string,
  ) {
    return this.svc.getGeneralServices(branchId, q)
  }
}
