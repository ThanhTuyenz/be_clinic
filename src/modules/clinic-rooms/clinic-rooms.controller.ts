import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { SkipPermissions } from 'src/common/decorators';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { AppPermission } from '../../common/constants/permissions.constant.js';
import { ClinicRoomsService } from './clinic-rooms.service.js';

@ApiTags('Clinic rooms')
@Controller(['clinic-rooms', 'reception'])
@SkipPermissions()
export class ClinicRoomsController {
  constructor(private readonly rooms: ClinicRoomsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Danh sách phòng khám' })
  listClinicRooms(@Query('activeOnly') activeOnly?: string) {
    return this.rooms.list(activeOnly !== 'false');
  }

  @ApiBearerAuth('access-token')
  @Get('rooms-status')
  @RequirePermissions(AppPermission.ROOM_READ)
  @ApiOperation({ summary: 'Tình trạng tải của các phòng khám bác sĩ theo thời gian thực' })
  @ApiQuery({ name: 'date', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'branchId', required: false, description: 'UUID chi nhánh (hoặc "all")' })
  getRoomsStatus(
    @Req() request: Request,
    @Query('date') date?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.rooms.getRoomsStatus(request.user!.id, { date, branchId });
  }
}
