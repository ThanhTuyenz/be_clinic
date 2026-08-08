import { Controller, Get, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import { Public } from '../common/decorators/public.decorator.js'
import { listClinicRooms as legacyListClinicRooms } from '../../src/controllers/clinicRoomsController.js'

@Public()
@Controller('clinic-rooms')
export class ClinicRoomsController {
  @Get()
  listClinicRooms(@Req() req: Request, @Res() res: Response) {
    return legacyListClinicRooms(req, res)
  }
}
