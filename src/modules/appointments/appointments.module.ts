import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { AppointmentsController } from '../../controllers/appointments.controller.js'
import { MailsModule } from '../mails/mails.module.js'
import { VouchersModule } from '../vouchers/vouchers.module.js'
import { RecommendationModule } from '../recommendations/recommendation.module.js'
import { SmsModule } from '../sms/sms.module.js'
import { AppointmentReminderTask } from './appointment-reminder.task.js'
import { BookingController, CheckInController, PaymentWebhookController } from './booking.controller.js'
import { BookingService } from './booking.service.js'
import { PaymentWebhookSignatureService } from './payment-webhook-signature.service.js'
import { StaffAppointmentsController } from './staff-appointments.controller.js'
import { StaffAppointmentsService } from './staff-appointments.service.js'

@Module({
  imports: [
    MailsModule,
    VouchersModule,
    RecommendationModule,
    SmsModule,
  ],
  controllers: [
    AppointmentsController,
    StaffAppointmentsController,
    BookingController,
    PaymentWebhookController,
    CheckInController,
  ],
  providers: [
    BookingService,
    PaymentWebhookSignatureService,
    StaffAppointmentsService,
    AppointmentReminderTask,
  ],
  exports: [BookingService],
})
export class AppointmentsModule {}
