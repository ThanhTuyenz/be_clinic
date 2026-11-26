import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { SkipPermissions } from 'src/common/decorators';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { AppPermission } from '../auth/permissions/constants/permissions.constant.js';
import { ClinicRoomsService } from './clinic-rooms.service.js';

class RoomsStatusQueryDto {
  @IsOptional() @IsString() date?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) branchId?: number;
}

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
  @ApiQuery({ name: 'branchId', required: false, description: 'ID số chi nhánh' })
  getRoomsStatus(
    @Req() request: Request,
    @Query() query: RoomsStatusQueryDto,
  ) {
    return this.rooms.getRoomsStatus(request.user!.id, query);
  }
}
