import { Body, Controller, HttpCode, Post, Req, Res, SetMetadata } from '@nestjs/common';
import type { Response } from 'express';
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

  @Post('chat/stream')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Streaming hỏi đáp trợ lý AI' })
  async chatStream(@Body() dto: AiChatMessageDto, @Req() req: Request, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const send = (payload: unknown) => {
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    try {
      const response = await this.assistant.chat(dto, req.user?.id, req.ip, delta => send({ type: 'delta', delta }));
      send({ type: 'response', data: response });
    } catch (error) {
      send({ type: 'error', message: error instanceof Error ? error.message : 'Trợ lý AI đang gián đoạn.' });
    } finally {
      if (!res.writableEnded) res.end();
    }
  }

}
