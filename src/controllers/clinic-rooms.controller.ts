import { Controller, Get, Query } from '@nestjs/common'
import { Public } from '../common/decorators/public.decorator.js'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { ClinicRoomsService } from '../modules/clinic-rooms/clinic-rooms.service.js'

@Public()
@ApiTags('Clinic rooms')
@Controller('clinic-rooms')
export class ClinicRoomsController {
  constructor(private readonly rooms: ClinicRoomsService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách phòng khám' })
  listClinicRooms(@Query('activeOnly') activeOnly?: string) {
    return this.rooms.list(activeOnly !== 'false')
  }
}
