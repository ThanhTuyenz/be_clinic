import { Body, Controller, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SkipPermissions } from '../../common/decorators/skip-permissions.decorator.js';
import { CounterPaymentsService } from './counter-payments.service.js';

@ApiTags('CounterPayments')
@ApiBearerAuth('access-token')
@Controller('payments/appointments')
@SkipPermissions()
export class CounterPaymentsController {
  constructor(private readonly payments: CounterPaymentsService) {}

  @Post(':id/counter')
  @ApiOperation({ summary: 'Ghi nhận thanh toán tại quầy' })
  payment(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: { method?: string; amount?: number; note?: string },
  ) {
    return this.payments.recordPayment(request.user!.id, id, body);
  }
}
