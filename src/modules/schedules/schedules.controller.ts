import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth-core/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { SkipPermissions } from 'src/common/decorators';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { AppPermission } from '../../common/constants/permissions.constant.js';
import { SchedulesService } from './schedules.service.js';

@ApiTags('Schedules')
@Controller('schedules')
export class SchedulesController {
  constructor(private readonly schedulesService: SchedulesService) {}

  @Public()
  @Get(['booking-methods', 'public/booking-methods'])
  @ApiOperation({ summary: 'Hình thức đặt khám đang bật tại một chi nhánh hoặc toàn hệ thống' })
  @ApiQuery({ name: 'branchId', required: false })
  bookingMethods(@Query('branchId') branchId?: string) {
    return this.schedulesService.bookingMethods(branchId);
  }

  @Get()
  @RequirePermissions(AppPermission.SCHEDULE_READ)
  @ApiOperation({ summary: 'Danh sách ca làm việc (có thể lọc theo doctorId, branchId, ngày, withSlots, availableOnly)' })
  findAll(
    @Query('doctorId') doctorId?: string,
    @Query('branchId') branchId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('withSlots') withSlots?: string,
    @Query('availableOnly') availableOnly?: string,
  ) {
    return this.schedulesService.findAll(
      doctorId,
      branchId,
      startDate,
      endDate,
      withSlots === 'true',
      availableOnly === 'true',
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('CHAIN_MANAGER', 'BRANCH_MANAGER', 'DOCTOR')
  @ApiBearerAuth()
  @Post()
  @RequirePermissions(AppPermission.SCHEDULE_CREATE)
  @ApiOperation({ summary: 'Tạo ca trực mới + tự động sinh slot' })
  create(@Body() body: any) {
    return this.schedulesService.create(body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('CHAIN_MANAGER', 'BRANCH_MANAGER', 'DOCTOR')
  @ApiBearerAuth()
  @Post('batch')
  @RequirePermissions(AppPermission.SCHEDULE_CREATE)
  @ApiOperation({ summary: 'Phân ca định kỳ / hàng loạt theo các thứ trong tuần' })
  createBatch(@Body() body: any) {
    return this.schedulesService.createBatch(body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('CHAIN_MANAGER', 'BRANCH_MANAGER', 'DOCTOR')
  @ApiBearerAuth()
  @Post('copy-week')
  @RequirePermissions(AppPermission.SCHEDULE_CREATE)
  @ApiOperation({ summary: 'Sao chép toàn bộ lịch trực từ tuần này sang tuần sau' })
  copyWeek(@Body() body: any) {
    return this.schedulesService.copyWeek(body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('CHAIN_MANAGER', 'BRANCH_MANAGER', 'DOCTOR')
  @ApiBearerAuth()
  @Patch(':id')
  @RequirePermissions(AppPermission.SCHEDULE_UPDATE)
  @ApiOperation({ summary: 'Cập nhật ca trực (tái sinh slot nếu thay đổi thời gian/capacity)' })
  update(@Param('id') id: string, @Body() body: any) {
    return this.schedulesService.update(id, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('CHAIN_MANAGER', 'BRANCH_MANAGER', 'DOCTOR')
  @ApiBearerAuth()
  @Delete(':id')
  @RequirePermissions(AppPermission.SCHEDULE_DELETE)
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
