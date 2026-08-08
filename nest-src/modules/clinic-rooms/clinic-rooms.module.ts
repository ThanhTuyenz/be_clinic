import { Module } from '@nestjs/common'
import { ClinicRoomsController } from '../../controllers/clinic-rooms.controller.js'

@Module({
  controllers: [ClinicRoomsController],
})
export class ClinicRoomsModule {}