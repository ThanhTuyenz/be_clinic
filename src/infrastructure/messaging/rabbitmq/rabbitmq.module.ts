import { Module } from '@nestjs/common';
import { AppointmentsModule } from '../../../modules/appointments/appointments.module.js';
import { RabbitMqService } from './rabbitmq.service.js';

@Module({ imports: [AppointmentsModule], providers: [RabbitMqService] })
export class RabbitMqModule {}
