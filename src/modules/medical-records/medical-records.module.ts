import { Module } from '@nestjs/common'
import { MedicalRecordsController } from './medical-records.controller.js'
import { MedicalRecordsService } from './medical-records.service.js'

@Module({
  controllers: [MedicalRecordsController],
  providers: [MedicalRecordsService],
  exports: [MedicalRecordsService],
})
export class MedicalRecordsModule {}
