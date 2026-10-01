import { Module, forwardRef } from '@nestjs/common';
import { BookingModule } from '../bookings/booking.module.js';
import { PaymentWebhookController } from './payment-webhook.controller.js';
import { PaymentWebhookSignatureService } from './payment-webhook-signature.service.js';
import { PaymentController } from './payment.controller.js';
import { PaymentService } from './payment.service.js';

@Module({
  imports: [forwardRef(() => BookingModule)],
  controllers: [PaymentController, PaymentWebhookController],
  providers: [PaymentService, PaymentWebhookSignatureService],
  exports: [PaymentService, PaymentWebhookSignatureService],
})
export class PaymentsModule {}
