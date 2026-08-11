import { Module } from '@nestjs/common'
import { ClinicalCatalogController } from './clinical-catalog.controller.js'
import { ClinicalCatalogService } from './clinical-catalog.service.js'

@Module({ controllers: [ClinicalCatalogController], providers: [ClinicalCatalogService] })
export class ClinicalCatalogModule {}
