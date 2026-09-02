import { Module, forwardRef } from '@nestjs/common'
import { AiAssistantController } from './ai-assistant.controller.js'
import { AiAssistantService } from './ai-assistant.service.js'
import { AppointmentsModule } from '../appointments/appointments.module.js'

@Module({
  imports: [forwardRef(() => AppointmentsModule)],
  controllers: [AiAssistantController],
  providers: [AiAssistantService],
  exports: [AiAssistantService],
})
export class AiAssistantModule {}
