import { Body, Controller, Get, Headers, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { SkipPermissions } from '../permissions/decorators/skip-permissions.decorator.js';
import { BookingService } from './booking.service.js';
import { CheckoutAppointmentDto } from './dtos/checkout-appointment.dto.js';
import { PaymentWebhookDto } from './dtos/payment-webhook.dto.js';
import { PaymentWebhookSignatureService } from './payment-webhook-signature.service.js';

@ApiTags('Appointments')
@ApiBearerAuth('access-token')
@Controller('appointments')
@SkipPermissions()
export class BookingController {
  constructor(private readonly bookingService: BookingService) {}

  @Post('checkout')
  @ApiOperation({ summary: 'Giữ chỗ 10 phút và tạo giao dịch thanh toán' })
  checkout(@Req() request: Request, @Body() dto: CheckoutAppointmentDto) {
    return this.bookingService.checkout(request.user!.id, dto);
  }

  @Get(':id/payment-status')
  @ApiOperation({ summary: 'Kiểm tra trạng thái thanh toán/lịch hẹn' })
  @ApiParam({ name: 'id', format: 'uuid' })
  paymentStatus(@Req() request: Request, @Param('id') id: string) {
    return this.bookingService.paymentStatus(id, request.user!.id);
  }
}

@ApiTags('Payments')
@Controller('payments')
export class PaymentWebhookController {
  constructor(private readonly bookingService: BookingService, private readonly signatures: PaymentWebhookSignatureService) {}

  @Public()
  @Post('webhooks/:provider')
  @ApiOperation({ summary: 'Webhook thanh toán idempotent (cần adapter xác thực chữ ký provider)' })
  webhook(@Req() request: Request & { rawBody?: Buffer }, @Param('provider') provider: string, @Headers('x-webhook-signature') signature: string | undefined, @Body() dto: PaymentWebhookDto) {
    this.signatures.verify(provider, request.rawBody, signature);
    return this.bookingService.handlePaymentWebhook(provider, dto);
  }
}

@ApiTags('Check-in')
@ApiBearerAuth('access-token')
@Controller('check-in')
@SkipPermissions()
export class CheckInController {
  constructor(private readonly bookingService: BookingService) {}

  @Post('qr/:token')
  @ApiOperation({ summary: 'Check-in bằng QR và cấp số thứ tự atomic theo timeslot' })
  checkIn(@Req() request: Request, @Param('token') token: string) {
    return this.bookingService.checkIn(token, request.user!.id);
  }
}
