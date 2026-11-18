import { ParseIntPipe } from '@nestjs/common';
import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { SkipPermissions } from '../../common/decorators/skip-permissions.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { PackageReceptionSlotsService } from './package-reception-slots.service.js';
import { CreatePackageReceptionSlotsDto, UpdatePackageReceptionSlotDto } from './dtos/package-reception-slot.dto.js';

@ApiTags('PackageReceptionSlots')
@ApiBearerAuth('access-token')
@Controller('package-reception-slots')
@Roles('BRANCH_MANAGER')
@UseGuards(RolesGuard)
@SkipPermissions()
export class PackageReceptionSlotsController {
  constructor(private readonly slots: PackageReceptionSlotsService) {}
  @Get() list(@Req() req: Request, @Query('servicePackageId', new ParseIntPipe({ optional: true })) packageId?: number) { return this.slots.list(req.user!.id, packageId); }
  @Post() create(@Req() req: Request, @Body() input: CreatePackageReceptionSlotsDto) { return this.slots.create(req.user!.id, input); }
  @Patch(':id') update(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body() input: UpdatePackageReceptionSlotDto) { return this.slots.update(req.user!.id, id, input); }
}
