import { Module } from '@nestjs/common';
import { MailsModule } from '../../mail/mails.module.js';
import { RecommendationModule } from '../../../modules/recommendations/recommendation.module.js';
import { HttpSmsModule } from '../../httpsms/httpsms.module.js';
import { RabbitMqService } from './rabbitmq.service.js';
import { PaymentsModule } from '../../../modules/payments/payments.module.js';

@Module({
  imports: [PaymentsModule, MailsModule, RecommendationModule, HttpSmsModule],
  providers: [RabbitMqService],
  exports: [RabbitMqService],
})
export class RabbitMqModule {}
