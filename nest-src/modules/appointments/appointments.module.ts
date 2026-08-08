import { Module } from '@nestjs/common'
import { AppointmentsController } from '../../controllers/appointments.controller.js'

@Module({
  controllers: [AppointmentsController],
})
export class AppointmentsModule {}
