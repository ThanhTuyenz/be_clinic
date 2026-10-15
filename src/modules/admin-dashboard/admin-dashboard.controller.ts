import { Controller, Get, Query, Req } from '@nestjs/common'
import type { Request } from 'express'
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { RequirePermissions } from 'src/common/decorators/require-permissions.decorator'
import { AppPermission } from 'src/common/constants/permissions.constant'
import { AdminDashboardService } from './admin-dashboard.service.js'

@ApiTags('Admin dashboard & Analytics')
@ApiBearerAuth('access-token')
@Controller('stats')
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  @Get('dashboard')
  @RequirePermissions(AppPermission.APPOINTMENT_READ)
  @ApiOperation({ summary: 'Thống kê tổng quan vận hành theo role và phạm vi chi nhánh' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Lọc theo UUID chi nhánh (hoặc "all")' })
  @ApiQuery({ name: 'timeFilter', required: false, enum: ['today', 'week', 'month'] })
  overview(
    @Req() request: Request,
    @Query('branchId') branchId?: string,
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
    @Query('branchId') branchId?: string,
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

  @Get('demand-insights')
  @RequirePermissions(AppPermission.REPORT_BRANCH_READ)
  @ApiOperation({ summary: 'Thống kê nhu cầu khám bệnh, phễu chuyển đổi và phân khúc nhân khẩu học (Hospital BI)' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Lọc theo chi nhánh' })
  @ApiQuery({ name: 'timeFilter', required: false, enum: ['today', 'week', 'month', 'quarter', '7days', '30days'] })
  @ApiQuery({ name: 'startDate', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'endDate', required: false, description: 'YYYY-MM-DD' })
  getDemandInsights(
    @Req() request: Request,
    @Query('branchId') branchId?: string,
    @Query('timeFilter') timeFilter?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.dashboard.getDemandMetrics(request.user!.id, { branchId, timeFilter, startDate, endDate })
  }

  @Get('ai-executive-report')
  @RequirePermissions(AppPermission.REPORT_BRANCH_READ)
  @ApiOperation({ summary: 'Lấy hoặc tạo Báo cáo Cố vấn Chiến lược Y tế từ AI Gemini' })
  @ApiQuery({ name: 'branchId', required: false })
  @ApiQuery({ name: 'timeFilter', required: false, enum: ['today', 'week', 'month', 'quarter', '7days', '30days'] })
  @ApiQuery({ name: 'startDate', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'endDate', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'forceRefresh', required: false, type: Boolean })
  getAiExecutiveReport(
    @Req() request: Request,
    @Query('branchId') branchId?: string,
    @Query('timeFilter') timeFilter?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('forceRefresh') forceRefresh?: string,
  ) {
    return this.dashboard.generateExecutiveAiReport(request.user!.id, {
      branchId,
      timeFilter,
      startDate,
      endDate,
      forceRefresh: forceRefresh === 'true' || forceRefresh === '1',
    })
  }

  @Get('system-logs')
  @RequirePermissions(AppPermission.SYSTEM_LOG_READ)
  @ApiOperation({ summary: 'Nhật ký hoạt động và giám sát lỗi hệ thống cho Quản trị viên' })
  getSystemLogs(@Req() request: Request) {
    return this.dashboard.getSystemLogs(request.user!.id)
  }
}


