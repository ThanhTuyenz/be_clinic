import { Controller, Post, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import { upsertExamination as legacyUpsertExamination } from '../../src/controllers/examinationsController.js'
import { SkipPermissions } from '../modules/permissions/decorators/skip-permissions.decorator.js'

@Controller('examinations')
@SkipPermissions()
export class ExaminationsController {
  @Post()
  upsertExamination(@Req() req: Request, @Res() res: Response) {
    return legacyUpsertExamination(req, res)
  }
}
