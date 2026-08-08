import { Controller, Get, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import { Public } from '../common/decorators/public.decorator.js'
import { listClinicRooms as legacyListClinicRooms } from '../../src/controllers/clinicRoomsController.js'
import { ApiOperation, ApiTags } from '@nestjs/swagger'

@Public()
@ApiTags('Clinic rooms')
@Controller('clinic-rooms')
export class ClinicRoomsController {
  @Get()
  @ApiOperation({ summary: 'Danh sách phòng khám' })
  listClinicRooms(@Req() req: Request, @Res() res: Response) {
    return legacyListClinicRooms(req, res)
  }
}
