import { Controller, Get, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import { Public } from '../common/decorators/public.decorator.js'
import { listDoctors as legacyListDoctors } from '../../src/controllers/doctorsController.js'
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'

@Public()
@ApiTags('Doctors')
@Controller('doctors')
export class DoctorsController {
  @Get()
  @ApiOperation({ summary: 'Danh sách bác sĩ đang hoạt động' })
  @ApiQuery({ name: 'specialtyId', required: false })
  listDoctors(@Req() req: Request, @Res() res: Response) {
    return legacyListDoctors(req, res)
  }
}
