import { Module } from '@nestjs/common'
import { ClinicalQueueController } from './clinical-queue.controller.js'
import { ClinicalQueueService } from './clinical-queue.service.js'
@Module({ controllers: [ClinicalQueueController], providers: [ClinicalQueueService] })
export class ClinicalQueueModule {}
