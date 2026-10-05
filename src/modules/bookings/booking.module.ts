import { Module } from '@nestjs/common';
import { MailsModule } from '../../infrastructure/mail/mails.module.js';
import { VouchersModule } from '../vouchers/vouchers.module.js';
import { NotificationModule } from '../notifications/notification.module.js';
import { BookingController, CheckInController } from './booking.controller.js';
import { BookingFlowController } from './booking-flow.controller.js';
import { BookingService } from './booking.service.js';
import { BookingFlowService } from './booking-flow.service.js';

@Module({
  imports: [
    MailsModule,
    VouchersModule,
    NotificationModule,
  ],
  controllers: [
    BookingController,
    CheckInController,
    BookingFlowController,
  ],
  providers: [
    BookingService,
    BookingFlowService,
  ],
  exports: [BookingService, BookingFlowService],
})
export class BookingModule {}
