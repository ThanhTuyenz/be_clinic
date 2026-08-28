import { Body, Controller, HttpCode, HttpStatus, Post, Res, SetMetadata } from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { Public } from '../../common/decorators/public.decorator.js'
import { SkipPermissions } from '../permissions/decorators/skip-permissions.decorator.js'
import { AiAssistantService } from './ai-assistant.service.js'
import { AiChatMessageDto, AiChatResponsePayload } from './dtos/ai-chat.dto.js'

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
  async chat(@Body() dto: AiChatMessageDto): Promise<AiChatResponsePayload> {
    return this.aiAssistantService.processUserMessage(dto)
  }

  @Post('stream')
  @ApiOperation({ summary: 'Stream phản hồi từng từ theo thời gian thực (Server-Sent Events)' })
  async chatStream(@Body() dto: AiChatMessageDto, @Res() res: Response): Promise<void> {
    return this.aiAssistantService.processUserMessageStream(dto, res)
  }
}
