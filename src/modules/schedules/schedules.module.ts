import { Module } from '@nestjs/common';
import { SchedulesController } from './schedules.controller.js';
import { SchedulesService } from './schedules.service.js';

import { ScheduleAvailabilityController } from './schedule-availability.controller.js';
import { ScheduleAvailabilityService } from './schedule-availability.service.js';

@Module({
  controllers: [ScheduleAvailabilityController, SchedulesController],
  providers: [SchedulesService, ScheduleAvailabilityService],
  exports: [SchedulesService],
})
export class SchedulesModule {}
