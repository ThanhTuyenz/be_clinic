import { Body, Controller, HttpCode, Post, Req, SetMetadata } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { SkipPermissions } from '../permissions/decorators/skip-permissions.decorator.js';
import { CreateMomoPaymentDto } from './dtos/create-momo-payment.dto.js';
import { MomoIpnDto } from './dtos/momo-ipn.dto.js';
import { MomoService } from './momo.service.js';

@ApiTags('Payments')
@Controller('payments/momo')
@SkipPermissions()
export class MomoController {
  constructor(private readonly momoService: MomoService) {}

  @ApiBearerAuth('access-token')
  @Post('create')
  @SetMetadata('requestTimeoutMs', 35_000)
  @ApiOperation({ summary: 'Tạo phiên thanh toán MoMo Sandbox' })
  create(@Req() request: Request, @Body() dto: CreateMomoPaymentDto) {
    return this.momoService.createPayment(request.user!.id, dto.paymentId, dto.paymentMethod);
  }

  @ApiBearerAuth('access-token')
  @Post('simulate-success')
  @ApiOperation({ summary: 'Mô phỏng thanh toán thành công (Dành cho Demo / Test)' })
  simulate(@Req() request: Request, @Body('paymentId') paymentId: string) {
    return this.momoService.simulateSuccess(request.user!.id, paymentId);
  }

  @Public()
  @Post('ipn')
  @HttpCode(204)
  @ApiOperation({ summary: 'Nhận và xác thực IPN từ MoMo' })
  async ipn(@Body() dto: MomoIpnDto): Promise<void> {
    await this.momoService.handleIpn(dto);
  }
}
