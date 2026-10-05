import { Module } from '@nestjs/common';
import { MailsModule } from '../../infrastructure/mail/mails.module.js';
import { RecommendationModule } from '../recommendations/recommendation.module.js';
import { ZaloZnsModule } from '../../infrastructure/zalo-zns/zalo-zns.module.js';
import { HttpSmsModule } from '../../infrastructure/httpsms/httpsms.module.js';
import { NotificationModule } from '../notifications/notification.module.js';
import { AppointmentReminderTask } from './appointment-reminder.task.js';
import { ReceptionController } from './reception.controller.js';
import { StaffAppointmentsController } from './staff-appointments.controller.js';
import { StaffAppointmentsService } from './staff-appointments.service.js';

@Module({
  imports: [
    MailsModule,
    RecommendationModule,
    ZaloZnsModule,
    HttpSmsModule,
    NotificationModule,
  ],
  controllers: [
    StaffAppointmentsController,
    ReceptionController,
  ],
  providers: [
    StaffAppointmentsService,
    AppointmentReminderTask,
  ],
  exports: [StaffAppointmentsService],
})
export class AppointmentsModule {}
