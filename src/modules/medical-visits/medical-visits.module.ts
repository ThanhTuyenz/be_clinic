import { Module } from '@nestjs/common'
import { MedicalVisitsController } from '../../controllers/medical-visits.controller.js'
import { MedicalVisitsService } from './medical-visits.service.js'

@Module({
  controllers: [MedicalVisitsController],
  providers: [MedicalVisitsService],
})
export class MedicalVisitsModule {}
