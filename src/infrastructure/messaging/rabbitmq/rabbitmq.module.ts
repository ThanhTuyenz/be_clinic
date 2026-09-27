import { Module } from '@nestjs/common';
import { BookingModule } from '../../../modules/bookings/booking.module.js';
import { MailsModule } from '../../mail/mails.module.js';
import { RecommendationModule } from '../../../modules/recommendations/recommendation.module.js';
import { ZaloZnsModule } from '../../zalo-zns/zalo-zns.module.js';
import { RabbitMqService } from './rabbitmq.service.js';

@Module({
  imports: [BookingModule, MailsModule, RecommendationModule, ZaloZnsModule],
  providers: [RabbitMqService],
  exports: [RabbitMqService],
})
export class RabbitMqModule {}
