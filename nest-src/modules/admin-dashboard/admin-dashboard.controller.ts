import { Controller, Get, Req } from '@nestjs/common'
import type { Request } from 'express'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { SkipPermissions } from '../permissions/decorators/skip-permissions.decorator.js'
import { AdminDashboardService } from './admin-dashboard.service.js'

@ApiTags('Admin dashboard')
@ApiBearerAuth('access-token')
@Controller('stats')
@SkipPermissions()
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Thống kê dashboard theo role và phạm vi chi nhánh' })
  overview(@Req() request: Request) {
    return this.dashboard.overview(request.user!.id)
  }
}
