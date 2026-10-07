import { Controller, Get, Query, Req } from '@nestjs/common'
import type { Request } from 'express'
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { SkipPermissions } from '../auth/permissions/decorators/skip-permissions.decorator.js'
import { AdminDashboardService } from './admin-dashboard.service.js'

@ApiTags('Admin dashboard & Analytics')
@ApiBearerAuth('access-token')
@Controller('stats')
@SkipPermissions()
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  @Get('dashboard')
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

  @Get('demand-insights')
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
}

