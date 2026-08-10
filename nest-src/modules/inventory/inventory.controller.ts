import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common'
import type { Request } from 'express'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { SkipPermissions } from '../permissions/decorators/skip-permissions.decorator.js'
import { InventoryService } from './inventory.service.js'

@ApiTags('Inventory')
@ApiBearerAuth('access-token')
@SkipPermissions()
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('stocks')
  stocks(@Req() request: Request, @Query('branchId') branchId: string, @Query('q') q = '') {
    return this.inventory.stocks(request.user!.id, branchId, q)
  }

  @Post('movements')
  createMovement(@Req() request: Request, @Body() body: Record<string, unknown>) {
    return this.inventory.createMovement(request.user!.id, body)
  }
}
