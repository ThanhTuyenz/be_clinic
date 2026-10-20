import { Module } from '@nestjs/common';
import { BookingModule } from '../bookings/booking.module.js';
import { PaymentReconciliationService } from './payment-reconciliation.service.js';
import { PaymentWebhookSignatureService } from './payment-webhook-signature.service.js';
import { PaymentWebhookController } from './payment-webhook.controller.js';
import { PaymentController } from './payment.controller.js';
import { PaymentService } from './payment.service.js';

import { CounterPaymentsController } from './counter-payments.controller.js';
import { CounterPaymentsService } from './counter-payments.service.js';

import { AppointmentsModule } from '../appointments/appointments.module.js';
import { PaymentSettlementService } from './payment-settlement.service.js';

@Module({
  imports: [BookingModule, AppointmentsModule],
  controllers: [CounterPaymentsController, PaymentController, PaymentWebhookController],
  providers: [PaymentSettlementService, CounterPaymentsService, PaymentService, PaymentWebhookSignatureService, PaymentReconciliationService],
  exports: [PaymentService, PaymentWebhookSignatureService, PaymentReconciliationService],
})
export class PaymentsModule {}
