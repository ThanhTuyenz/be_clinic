import { Module, forwardRef } from '@nestjs/common';
import { BookingModule } from '../bookings/booking.module.js';
import { PaymentWebhookController } from './payment-webhook.controller.js';
import { PaymentWebhookSignatureService } from './payment-webhook-signature.service.js';
import { PaymentController } from './payment.controller.js';
import { PaymentService } from './payment.service.js';
import { PaymentReconciliationService } from './payment-reconciliation.service.js';

@Module({
  imports: [forwardRef(() => BookingModule)],
  controllers: [PaymentController, PaymentWebhookController],
  providers: [PaymentService, PaymentWebhookSignatureService, PaymentReconciliationService],
  exports: [PaymentService, PaymentWebhookSignatureService, PaymentReconciliationService],
})
export class PaymentsModule {}
