import { Controller, Get, Query, Req } from '@nestjs/common'
import type { Request } from 'express'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { SkipPermissions } from '../permissions/decorators/skip-permissions.decorator.js'
import { ClinicalCatalogService } from './clinical-catalog.service.js'

@ApiTags('Clinical catalog')
@ApiBearerAuth('access-token')
@SkipPermissions()
@Controller()
export class ClinicalCatalogController {
  constructor(private readonly catalog: ClinicalCatalogService) {}

  @Get('medicines')
  medicines(@Req() request: Request, @Query('q') q = '', @Query('limit') limit = '25') {
    return this.catalog.medicines(request.user!.id, q, Number(limit))
  }

  @Get('icd10')
  icd10(@Req() request: Request, @Query('q') q = '', @Query('limit') limit = '20', @Query('deptID') departmentId?: string) {
    return this.catalog.icd10(request.user!.id, q, Number(limit), departmentId ? Number(departmentId) : undefined)
  }
}
