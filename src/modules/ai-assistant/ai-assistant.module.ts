import { Module } from '@nestjs/common';
import { AiAssistantController } from './ai-assistant.controller.js';
import { AiAssistantService } from './ai-assistant.service.js';
import { BookingModule } from '../bookings/booking.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { AiPaymentStatusService } from './ai-payment-status.service.js';

@Module({
  imports: [BookingModule, CatalogModule, PaymentsModule],
  controllers: [AiAssistantController],
  providers: [AiAssistantService, AiPaymentStatusService],
  exports: [AiAssistantService],
})
export class AiAssistantModule {}
