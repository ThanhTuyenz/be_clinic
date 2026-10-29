import { Module } from '@nestjs/common';
import { AiAssistantController } from './ai-assistant.controller.js';
import { AiAssistantService } from './ai-assistant.service.js';
import { BookingModule } from '../bookings/booking.module.js';
import { SpecialtiesModule } from '../specialties/specialties.module.js';

@Module({
  imports: [BookingModule, SpecialtiesModule],
  controllers: [AiAssistantController],
  providers: [AiAssistantService],
  exports: [AiAssistantService],
})
export class AiAssistantModule {}
