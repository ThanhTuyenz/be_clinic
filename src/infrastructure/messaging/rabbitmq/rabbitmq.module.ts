import { Module } from '@nestjs/common';
import { AppointmentsModule } from '../../../modules/appointments/appointments.module.js';
import { MailsModule } from '../../../modules/mails/mails.module.js';
import { RecommendationModule } from '../../../modules/recommendations/recommendation.module.js';
import { SmsModule } from '../../../modules/sms/sms.module.js';
import { RabbitMqService } from './rabbitmq.service.js';

@Module({ imports: [AppointmentsModule, MailsModule, RecommendationModule, SmsModule], providers: [RabbitMqService] })
export class RabbitMqModule {}
