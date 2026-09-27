import { Module } from '@nestjs/common';
import { MailsModule } from '../../infrastructure/mail/mails.module.js';
import { VouchersModule } from '../vouchers/vouchers.module.js';
import { BookingController, CheckInController } from './booking.controller.js';
import { BookingService } from './booking.service.js';

@Module({
  imports: [
    MailsModule,
    VouchersModule,
  ],
  controllers: [
    BookingController,
    CheckInController,
  ],
  providers: [
    BookingService,
  ],
  exports: [BookingService],
})
export class BookingModule {}
