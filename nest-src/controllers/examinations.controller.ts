import { Controller, Post, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import { upsertExamination as legacyUpsertExamination } from '../../src/controllers/examinationsController.js'
import { SkipPermissions } from '../modules/permissions/decorators/skip-permissions.decorator.js'
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger'

@ApiTags('Examinations')
@ApiBearerAuth('access-token')
@Controller('examinations')
@SkipPermissions()
export class ExaminationsController {
  @Post()
  @ApiOperation({ summary: 'Tạo hoặc cập nhật hồ sơ khám bệnh' })
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  upsertExamination(@Req() req: Request, @Res() res: Response) {
    return legacyUpsertExamination(req, res)
  }
}
