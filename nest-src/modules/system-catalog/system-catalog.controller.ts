import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import type { Request } from 'express'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { SkipPermissions } from '../permissions/decorators/skip-permissions.decorator.js'
import { SystemCatalogService } from './system-catalog.service.js'

@ApiTags('System catalog') @ApiBearerAuth('access-token') @SkipPermissions() @Controller('admin/catalog')
export class SystemCatalogController {
  constructor(private readonly service:SystemCatalogService){}
  @Get(':resource') list(@Req() req:Request,@Param('resource') resource:string,@Query('q') q=''){return this.service.list(req.user!.id,resource,q)}
  @Post(':resource') create(@Req() req:Request,@Param('resource') resource:string,@Body() body:any){return this.service.create(req.user!.id,resource,body)}
  @Patch(':resource/:id') update(@Req() req:Request,@Param('resource') resource:string,@Param('id') id:string,@Body() body:any){return this.service.update(req.user!.id,resource,id,body)}
  @Delete(':resource/:id') remove(@Req() req:Request,@Param('resource') resource:string,@Param('id') id:string){return this.service.remove(req.user!.id,resource,id)}
}
