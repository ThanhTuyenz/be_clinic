import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res, SetMetadata } from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { Public } from '../../common/decorators/public.decorator.js'
import { SkipPermissions } from '../auth/permissions/decorators/skip-permissions.decorator.js'
import { AiAssistantService } from './ai-assistant.service.js'
import { AiChatMessageDto, AiChatResponsePayload, AiAgentChatDto, AiAgentChatResponse } from './dtos/ai-chat.dto.js'

@ApiTags('AI Medical Assistant')
@Public()
@SkipPermissions()
@SetMetadata('requestTimeoutMs', 60000)
@Controller({ path: 'ai', version: '1' })
export class AiAssistantController {
  constructor(private readonly aiAssistantService: AiAssistantService) {}

  @Post('chat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Gửi tin nhắn tư vấn triệu chứng y khoa tới AI Assistant (REST)' })
  @ApiResponse({ status: 200, description: 'Phân tích triệu chứng và đề xuất chuyên khoa thành công' })
  async chat(@Body() dto: AiChatMessageDto, @Req() req: Request): Promise<AiChatResponsePayload> {
    return this.aiAssistantService.processUserMessage(dto, req.user?.id)
  }

  @Post('stream')
  @ApiOperation({ summary: 'Stream phản hồi từng từ theo thời gian thực (Server-Sent Events)' })
  async chatStream(@Body() dto: AiChatMessageDto, @Res() res: Response, @Req() req: Request): Promise<void> {
    return this.aiAssistantService.processUserMessageStream(dto, res, req.user?.id)
  }

  @Post('agent/chat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'AI Booking Agent: Đàm thoại tự động tìm slot và tạo lịch hẹn' })
  @ApiResponse({ status: 200, description: 'Gợi ý slot hoặc tạo lịch hẹn thành công' })
  async agentChat(@Body() dto: AiAgentChatDto, @Req() req: Request): Promise<AiAgentChatResponse> {
    return this.aiAssistantService.handleAgentMessage(dto, req.user?.id)
  }
}
