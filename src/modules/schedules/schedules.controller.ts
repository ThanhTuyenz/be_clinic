import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import { JwtAuthGuard } from '../auth/auth-local/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { SkipPermissions } from '../permissions/decorators/skip-permissions.decorator.js';
import { SchedulesService } from './schedules.service.js';

@ApiTags('Schedules')
@Controller('schedules')
export class SchedulesController {
  constructor(private readonly schedulesService: SchedulesService) {}

  @Get()
  @SkipPermissions()
  @ApiOperation({ summary: 'Danh sách ca làm việc (có thể lọc theo doctorId, branchId, ngày)' })
  findAll(
    @Query('doctorId') doctorId?: string,
    @Query('branchId') branchId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.schedulesService.findAll(doctorId, branchId, startDate, endDate);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER')
  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'Tạo ca trực mới + tự động sinh slot' })
  create(@Body() body: any) {
    return this.schedulesService.create(body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER')
  @ApiBearerAuth()
  @Patch(':id')
  @ApiOperation({ summary: 'Cập nhật ca trực (tái sinh slot nếu thay đổi thời gian/capacity)' })
  update(@Param('id') id: string, @Body() body: any) {
    return this.schedulesService.update(id, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER')
  @ApiBearerAuth()
  @Delete(':id')
  @ApiOperation({ summary: 'Xóa ca trực (cascade xóa slot)' })
  remove(@Param('id') id: string) {
    return this.schedulesService.remove(id);
  }

  // ─── Public: lấy slot còn chỗ của bác sĩ ──────────────────
  @Get('doctors/:doctorId/available-slots')
  @Public()
  @SkipPermissions()
  @ApiOperation({ summary: 'Slot còn chỗ của bác sĩ theo ngày' })
  @ApiParam({ name: 'doctorId', format: 'uuid' })
  @ApiQuery({ name: 'date', description: 'YYYY-MM-DD', required: true })
  @ApiQuery({ name: 'branchId', required: false })
  getAvailableSlots(
    @Param('doctorId') doctorId: string,
    @Query('date') date: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.schedulesService.getAvailableSlots(doctorId, date, branchId);
  }
}
