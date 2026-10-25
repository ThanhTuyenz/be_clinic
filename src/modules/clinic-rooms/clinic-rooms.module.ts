import { Module } from '@nestjs/common';
import { ClinicRoomsController } from './clinic-rooms.controller.js';
import { ClinicRoomsService } from './clinic-rooms.service.js';

@Module({
  controllers: [ClinicRoomsController],
  providers: [ClinicRoomsService],
  exports: [ClinicRoomsService],
})
export class ClinicRoomsModule {}
