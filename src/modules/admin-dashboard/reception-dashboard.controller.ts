import { Controller, Get, Query, Req } from '@nestjs/common'
import type { Request } from 'express'
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { SkipPermissions } from '../permissions/decorators/skip-permissions.decorator.js'
import { ReceptionDashboardService } from './reception-dashboard.service.js'

@ApiTags('Reception Desk Operations')
@ApiBearerAuth('access-token')
@Controller('reception')
@SkipPermissions()
export class ReceptionDashboardController {
  constructor(private readonly service: ReceptionDashboardService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Thẻ đếm ca khám & tiền két quầy thu ngân trong ca trực' })
  @ApiQuery({ name: 'date', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'branchId', required: false, description: 'UUID chi nhánh (hoặc "all")' })
  getSummary(
    @Req() request: Request,
    @Query('date') date?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.service.getSummary(request.user!.id, { date, branchId })
  }

  @Get('rooms-status')
  @ApiOperation({ summary: 'Tình trạng tải của các phòng khám bác sĩ theo thời gian thực' })
  @ApiQuery({ name: 'date', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'branchId', required: false, description: 'UUID chi nhánh (hoặc "all")' })
  getRoomsStatus(
    @Req() request: Request,
    @Query('date') date?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.service.getRoomsStatus(request.user!.id, { date, branchId })
  }

  @Get('upcoming')
  @ApiOperation({ summary: 'Danh sách rút gọn các ca khám sắp tới cần tiếp đón' })
  @ApiQuery({ name: 'date', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'branchId', required: false, description: 'UUID chi nhánh (hoặc "all")' })
  @ApiQuery({ name: 'limit', required: false, description: 'Số lượng bản ghi (mặc định 5)' })
  getUpcoming(
    @Req() request: Request,
    @Query('date') date?: string,
    @Query('branchId') branchId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getUpcoming(request.user!.id, {
      date,
      branchId,
      limit: limit ? parseInt(limit, 10) : 5,
    })
  }
}
