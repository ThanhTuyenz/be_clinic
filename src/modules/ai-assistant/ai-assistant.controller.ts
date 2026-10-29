import { Body, Controller, HttpCode, Post, Req, SetMetadata } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { SkipPermissions } from '../../common/decorators/skip-permissions.decorator.js';
import { AiAssistantService } from './ai-assistant.service.js';
import { AiChatMessageDto } from './dtos/ai-chat.dto.js';

@ApiTags('AI Assistant')
@SkipPermissions()
@SetMetadata('requestTimeoutMs', 60000)
@Controller({ path: 'ai', version: '1' })
export class AiAssistantController {
  constructor(private readonly assistant: AiAssistantService) {}

  @Post('chat')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Hỏi đáp, tìm dịch vụ, bác sĩ và lịch trống bằng OpenAI' })
  chat(@Body() dto: AiChatMessageDto, @Req() req: Request) {
    return this.assistant.chat(dto, req.user?.id, req.ip);
  }

}
