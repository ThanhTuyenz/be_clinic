import { Module } from '@nestjs/common'
import { AiAssistantController } from './ai-assistant.controller.js'
import { AiAssistantService } from './ai-assistant.service.js'
import { PiiSanitizerService } from './services/pii-sanitizer.service.js'
import { GeminiLlmService } from './services/gemini-llm.service.js'
import { DeterministicClinicalService } from './services/deterministic-clinical.service.js'

@Module({
  controllers: [AiAssistantController],
  providers: [
    AiAssistantService,
    PiiSanitizerService,
    GeminiLlmService,
    DeterministicClinicalService,
  ],
  exports: [AiAssistantService],
})
export class AiAssistantModule {}
