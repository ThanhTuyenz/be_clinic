import { Module, forwardRef } from '@nestjs/common';
import { BookingModule } from '../bookings/booking.module.js';
import { PaymentWebhookController } from './payment-webhook.controller.js';
import { PaymentWebhookSignatureService } from './payment-webhook-signature.service.js';
import { MomoController } from './payments.controller.js';
import { MomoService } from './momo.service.js';

@Module({
  imports: [forwardRef(() => BookingModule)],
  controllers: [MomoController, PaymentWebhookController],
  providers: [MomoService, PaymentWebhookSignatureService],
  exports: [MomoService, PaymentWebhookSignatureService],
})
export class PaymentsModule {}
