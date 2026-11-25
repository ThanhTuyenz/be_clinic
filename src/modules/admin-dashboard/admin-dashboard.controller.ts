import { ParseIntPipe } from '@nestjs/common';
import { ExcludeRoles } from '../../common/decorators/exclude-roles.decorator.js';
import { Controller, Get, Query, Req } from '@nestjs/common'
import type { Request } from 'express'
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { RequirePermissions } from 'src/common/decorators/require-permissions.decorator'
import { AppPermission } from '../auth/permissions/constants/permissions.constant.js'
import { ReceptionSummaryService } from './reception-summary.service.js'
import { AdminDashboardService } from './admin-dashboard.service.js'

@ApiTags('Admin dashboard & Analytics')
@ApiBearerAuth('access-token')
@Controller('stats')
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService, private readonly reception: ReceptionSummaryService) {}

  @ExcludeRoles('CHAIN_MANAGER')
  @Get('reception-summary')
  @RequirePermissions(AppPermission.APPOINTMENT_READ)
  @ApiOperation({ summary: 'Thống kê tiếp nhận và thu ngân theo phạm vi chi nhánh' })
  @ApiQuery({ name: 'date', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'branchId', required: false, description: 'ID số của chi nhánh; bỏ trống để xem toàn bộ phạm vi được phép' })
  receptionSummary(
    @Req() request: Request,
    @Query('date') date?: string,
    @Query('branchId', new ParseIntPipe({ optional: true })) branchId?: number,
  ) {
    return this.reception.getReceptionSummary(request.user!.id, { date, branchId })
  }

  @Get('dashboard')
  @RequirePermissions(AppPermission.APPOINTMENT_READ)
  @ApiOperation({ summary: 'Thống kê tổng quan vận hành theo role và phạm vi chi nhánh' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Lọc theo ID số của chi nhánh; bỏ trống để xem toàn bộ phạm vi được phép' })
  @ApiQuery({ name: 'timeFilter', required: false, enum: ['today', 'week', 'month'] })
  overview(
    @Req() request: Request,
    @Query('branchId', new ParseIntPipe({ optional: true })) branchId?: number,
    @Query('timeFilter') timeFilter?: 'today' | 'week' | 'month',
  ) {
    return this.dashboard.overview(request.user!.id, { branchId, timeFilter })
  }

  @Get('analytics')
  @RequirePermissions(AppPermission.REPORT_BRANCH_READ)
  @ApiOperation({ summary: 'Báo cáo và phân tích chuyên sâu cho ban giám đốc và quản lý chi nhánh' })
  @ApiQuery({ name: 'timeFilter', required: false, enum: ['today', 'week', 'month', 'quarter'] })
  @ApiQuery({ name: 'branchId', required: false })
  @ApiQuery({ name: 'startDate', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'endDate', required: false, description: 'YYYY-MM-DD' })
  analytics(
    @Req() request: Request,
    @Query('timeFilter') timeFilter?: string,
    @Query('branchId', new ParseIntPipe({ optional: true })) branchId?: number,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.dashboard.analytics(request.user!.id, { timeFilter, branchId, startDate, endDate })
  }

  @Get('branch-comparison')
  @RequirePermissions(AppPermission.REPORT_BRANCH_READ)
  @ApiOperation({ summary: 'So sánh hoạt động và doanh thu các chi nhánh dành cho quản lý toàn chuỗi' })
  branchComparison(
    @Req() request: Request,
    @Query('timeFilter') timeFilter?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.dashboard.compareBranches(request.user!.id, { timeFilter, startDate, endDate })
  }

  @Get('system-logs')
  @RequirePermissions(AppPermission.SYSTEM_LOG_READ)
  @ApiOperation({ summary: 'Nhật ký hoạt động và giám sát lỗi hệ thống cho Quản trị viên' })
  getSystemLogs(@Req() request: Request) {
    return this.dashboard.getSystemLogs(request.user!.id)
  }
}


