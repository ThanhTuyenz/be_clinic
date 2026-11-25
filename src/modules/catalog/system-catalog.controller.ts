import { ParseIntPipe } from '@nestjs/common';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import type { Request } from 'express'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { SkipPermissions } from 'src/common/decorators'
import { SystemCatalogService } from './system-catalog.service.js'
import { UpdatePackageReceptionDto } from './dtos/update-package-reception.dto.js'
import { BranchGeocodingService } from './branch-geocoding.service.js'
import { BranchManagementService } from './branch-management.service.js'
import { AssignBranchManagerDto } from './dtos/assign-branch-manager.dto.js'

@ApiTags('System catalog') @ApiBearerAuth('access-token') @SkipPermissions() @Controller('admin/catalog')
export class SystemCatalogController {
  constructor(private readonly service:SystemCatalogService, private readonly geocoding: BranchGeocodingService, private readonly management: BranchManagementService){}
  @Get('branches/:branchId/manager-options')
  managerOptions(@Req() req: Request, @Param('branchId', ParseIntPipe) branchId: number, @Query('q') q = '') {
    return this.management.options(req.user!.id, branchId, q)
  }
  @Patch('branches/:branchId/manager')
  assignManager(@Req() req: Request, @Param('branchId', ParseIntPipe) branchId: number, @Body() body: AssignBranchManagerDto) {
    return this.management.assign(req.user!.id, branchId, body)
  }
  @Post('branches/geocode')
  geocodeBranch(@Req() req: Request, @Body('address') address: string) {
    return this.geocoding.search(req.user!.id, address)
  }
  @Patch('branch-packages/:id/reception-schedules')
  setReceptionSchedules(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body() body: UpdatePackageReceptionDto) {
    return this.service.setReceptionSchedules(req.user!.id, id, body)
  }
  @Patch('branch-packages/:id') setBranchPackage(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body() body: { branchId: number; isDeployed: boolean; schedules?: UpdatePackageReceptionDto['schedules'] }) {
    return this.service.setBranchPackage(req.user!.id, id, body)
  }
  @Get(':resource') list(@Req() req:Request,@Param('resource') resource:string,@Query('q') q=''){return this.service.list(req.user!.id,resource,q)}
  @Post('branch-specialties/batch') batchBranchSpecialties(@Req() req: Request, @Body() body: { branchId: number; specialtyIds: number[] }) {
    return this.service.batchBranchSpecialties(req.user!.id, body)
  }
  @Post('room-specialties/batch') batchRoomSpecialties(@Req() req: Request, @Body() body: { specialtyId: number; roomIds: number[] }) {
    return this.service.batchRoomSpecialties(req.user!.id, body)
  }
  @Post('service-packages/sync-vectors') syncPackageVectors(@Req() req: Request) {
    return this.service.syncAllPackageVectors(req.user!.id)
  }
  @Post(':resource') create(@Req() req:Request,@Param('resource') resource:string,@Body() body:any){return this.service.create(req.user!.id,resource,body)}
  @Patch(':resource/:id') update(@Req() req:Request,@Param('resource') resource:string,@Param('id', ParseIntPipe) id:number,@Body() body:any){return this.service.update(req.user!.id,resource,id,body)}
  @Delete(':resource/:id') remove(@Req() req:Request,@Param('resource') resource:string,@Param('id', ParseIntPipe) id:number){return this.service.remove(req.user!.id,resource,id)}
}
