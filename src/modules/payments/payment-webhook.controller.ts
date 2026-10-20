import { Body, Controller, Headers, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { PaymentWebhookDto } from './dtos/payment-webhook.dto.js';
import { PaymentSettlementService } from './payment-settlement.service.js';
import { PaymentWebhookSignatureService } from './payment-webhook-signature.service.js';

@ApiTags('Payments')
@Controller('payments')
export class PaymentWebhookController {
  constructor(
    private readonly settlement: PaymentSettlementService,
    private readonly signatures: PaymentWebhookSignatureService,
  ) {}

  @Public()
  @Post('webhooks/:provider')
  @ApiOperation({ summary: 'Webhook thanh toán idempotent (cần adapter xác thực chữ ký provider)' })
  webhook(
    @Req() request: Request & { rawBody?: Buffer },
    @Param('provider') provider: string,
    @Headers('x-webhook-signature') signature: string | undefined,
    @Body() dto: PaymentWebhookDto,
  ) {
    this.signatures.verify(provider, request.rawBody, signature);
    return this.settlement.handlePaymentWebhook(provider, dto);
  }
}
