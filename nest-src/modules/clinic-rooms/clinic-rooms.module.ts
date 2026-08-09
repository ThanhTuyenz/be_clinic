import { Module } from '@nestjs/common'
import { ClinicRoomsController } from '../../controllers/clinic-rooms.controller.js'
import { ClinicRoomsService } from './clinic-rooms.service.js'

@Module({
  controllers: [ClinicRoomsController],
  providers: [ClinicRoomsService],
})
export class ClinicRoomsModule {}
