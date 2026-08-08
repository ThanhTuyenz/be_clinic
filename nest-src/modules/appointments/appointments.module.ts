import { Module } from '@nestjs/common'
import { AppointmentsController } from '../../controllers/appointments.controller.js'
import { BookingController, CheckInController, PaymentWebhookController } from './booking.controller.js'
import { BookingService } from './booking.service.js'
import { PaymentWebhookSignatureService } from './payment-webhook-signature.service.js'

@Module({
  controllers: [AppointmentsController, BookingController, PaymentWebhookController, CheckInController],
  providers: [BookingService, PaymentWebhookSignatureService],
  exports: [BookingService],
})
export class AppointmentsModule {}
