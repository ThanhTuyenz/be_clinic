import { Module } from '@nestjs/common'
import { AppointmentsController } from '../../controllers/appointments.controller.js'
import { BookingController, CheckInController, PaymentWebhookController } from './booking.controller.js'
import { BookingService } from './booking.service.js'
import { PaymentWebhookSignatureService } from './payment-webhook-signature.service.js'
import { StaffAppointmentsController } from './staff-appointments.controller.js'
import { StaffAppointmentsService } from './staff-appointments.service.js'

@Module({
  controllers: [AppointmentsController, StaffAppointmentsController, BookingController, PaymentWebhookController, CheckInController],
  providers: [BookingService, PaymentWebhookSignatureService, StaffAppointmentsService],
  exports: [BookingService],
})
export class AppointmentsModule {}
