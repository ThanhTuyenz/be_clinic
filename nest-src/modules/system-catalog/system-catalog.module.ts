import { Module } from '@nestjs/common'
import { SystemCatalogController } from './system-catalog.controller.js'
import { SystemCatalogService } from './system-catalog.service.js'
@Module({controllers:[SystemCatalogController],providers:[SystemCatalogService]})
export class SystemCatalogModule {}
