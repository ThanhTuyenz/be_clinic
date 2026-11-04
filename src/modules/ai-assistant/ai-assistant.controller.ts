import { Body, Controller, HttpCode, Post, Req, SetMetadata } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { SkipPermissions } from '../../common/decorators/skip-permissions.decorator.js';
import { AiAssistantService } from './ai-assistant.service.js';
import { AiChatMessageDto } from './dtos/ai-chat.dto.js';
import { ExcludeRoles } from '../../common/decorators/exclude-roles.decorator.js';
import { AiBookingService } from './ai-booking.service.js';
import { AiBookingSessionDto, ConfirmAiBookingDto, PrepareAiBookingDto } from './dtos/ai-booking.dto.js';

@ApiTags('AI Assistant')
@SkipPermissions()
@SetMetadata('requestTimeoutMs', 60000)
@Controller({ path: 'ai', version: '1' })
export class AiAssistantController {
  constructor(private readonly assistant: AiAssistantService, private readonly booking: AiBookingService) {}

  @Post('booking/prepare')
  @ExcludeRoles('CHAIN_MANAGER')
  @ApiBearerAuth('access-token')
  prepare(@Body() dto: PrepareAiBookingDto, @Req() req: Request) {
    return this.booking.prepare(req.user!.id, dto);
  }

  @Post('booking/confirm')
  @ExcludeRoles('CHAIN_MANAGER')
  @ApiBearerAuth('access-token')
  confirm(@Body() dto: ConfirmAiBookingDto, @Req() req: Request) {
    return this.booking.confirm(req.user!.id, dto);
  }

  @Post('booking/state')
  @ExcludeRoles('CHAIN_MANAGER')
  @ApiBearerAuth('access-token')
  state(@Body() dto: AiBookingSessionDto, @Req() req: Request) {
    return this.booking.state(req.user!.id, dto.sessionId);
  }

  @Post('booking/payment')
  @ExcludeRoles('CHAIN_MANAGER')
  @ApiBearerAuth('access-token')
  payment(@Body() dto: AiBookingSessionDto, @Req() req: Request) {
    return this.booking.createPayment(req.user!.id, dto.sessionId);
  }

  @Post('booking/cancel')
  @ExcludeRoles('CHAIN_MANAGER')
  @ApiBearerAuth('access-token')
  cancel(@Body() dto: AiBookingSessionDto, @Req() req: Request) {
    return this.booking.cancel(req.user!.id, dto.sessionId);
  }

  @Post('chat')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Hỏi đáp, tìm dịch vụ, bác sĩ và lịch trống bằng OpenAI' })
  chat(@Body() dto: AiChatMessageDto, @Req() req: Request) {
    return this.assistant.chat(dto, req.user?.id, req.ip);
  }

}
