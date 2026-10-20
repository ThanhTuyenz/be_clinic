import { Module } from '@nestjs/common';
import { HttpSmsModule } from '../../infrastructure/httpsms/httpsms.module.js';
import { MailsModule } from '../../infrastructure/mail/mails.module.js';
import { NotificationModule } from '../notifications/notification.module.js';
import { RecommendationModule } from '../recommendations/recommendation.module.js';
import { AppointmentReminderTask } from './appointment-reminder.task.js';
import { AppointmentsController } from './appointments.controller.js';
import { AppointmentsService } from './appointments.service.js';

import { PatientAppointmentsController } from './patient-appointments.controller.js';
import { PatientAppointmentsService } from './patient-appointments.service.js';

import { AppointmentConfirmationService } from './appointment-confirmation.service.js';

@Module({
  imports: [
    MailsModule,
    RecommendationModule,
    HttpSmsModule,
    NotificationModule,
  ],
  controllers: [
    AppointmentsController,
    PatientAppointmentsController,
  ],
  providers: [
    AppointmentsService,
    AppointmentConfirmationService,
    PatientAppointmentsService,
    AppointmentReminderTask,
  ],
  exports: [AppointmentConfirmationService],
})
export class AppointmentsModule { }
