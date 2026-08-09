import { Module } from '@nestjs/common';
import { AppointmentsModule } from '../appointments/appointments.module.js';
import { MomoController } from './payments.controller.js';
import { MomoService } from './momo.service.js';

@Module({
  imports: [AppointmentsModule],
  controllers: [MomoController],
  providers: [MomoService],
})
export class PaymentsModule {}
