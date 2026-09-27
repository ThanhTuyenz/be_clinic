import { Module, forwardRef } from '@nestjs/common';
import { AiAssistantController } from './ai-assistant.controller.js';
import { AiAssistantService } from './ai-assistant.service.js';
import { BookingModule } from '../bookings/booking.module.js';

@Module({
  imports: [forwardRef(() => BookingModule)],
  controllers: [AiAssistantController],
  providers: [AiAssistantService],
  exports: [AiAssistantService],
})
export class AiAssistantModule {}
