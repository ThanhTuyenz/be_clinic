import { Module } from '@nestjs/common';
import { RecommendationModule } from '../recommendations/recommendation.module.js';
import { VouchersModule } from '../vouchers/vouchers.module.js';
import { BookingFlowController } from './booking-flow.controller.js';
import { BookingFlowService } from './booking-flow.service.js';
import { BookingController } from './booking.controller.js';
import { BookingService } from './booking.service.js';

import { ReceptionBookingController } from './reception-booking.controller.js';
import { ReceptionBookingService } from './reception-booking.service.js';

import { PatientsModule } from '../patients/patients.module.js';
import { PackageReceptionSlotsController } from './package-reception-slots.controller.js';
import { PackageReceptionSlotsService } from './package-reception-slots.service.js';

@Module({
  imports: [
    PatientsModule,
    RecommendationModule,
    VouchersModule,
  ],
  controllers: [
    BookingController,
    ReceptionBookingController,
    BookingFlowController,
    PackageReceptionSlotsController,
  ],
  providers: [
    BookingService,
    ReceptionBookingService,
    BookingFlowService,
    PackageReceptionSlotsService,
  ],
  exports: [BookingService, BookingFlowService],
})
export class BookingModule {}
