import { Module } from '@nestjs/common'
import { DoctorsController } from '../../controllers/doctors.controller.js'

@Module({
  controllers: [DoctorsController],
})
export class DoctorsModule {}