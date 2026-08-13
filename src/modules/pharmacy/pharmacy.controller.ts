import { Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import type { Request } from 'express'
import { SkipPermissions } from '../permissions/decorators/skip-permissions.decorator.js'
import { PharmacyService } from './pharmacy.service.js'

@Controller('pharmacy') @SkipPermissions()
export class PharmacyController {
  constructor(private readonly pharmacy: PharmacyService) {}
  @Get('prescriptions') list(@Req() req: Request, @Query('status') status?: string, @Query('q') q?: string) { return this.pharmacy.list(req.user!.id, status, q) }
  @Post('prescriptions/:id/dispense') dispense(@Req() req: Request, @Param('id') id: string) { return this.pharmacy.dispense(req.user!.id, id) }
}
