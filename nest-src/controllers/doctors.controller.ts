import { Controller, Get, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import { Public } from '../common/decorators/public.decorator.js'
import { listDoctors as legacyListDoctors } from '../../src/controllers/doctorsController.js'

@Public()
@Controller('doctors')
export class DoctorsController {
  @Get()
  listDoctors(@Req() req: Request, @Res() res: Response) {
    return legacyListDoctors(req, res)
  }
}
