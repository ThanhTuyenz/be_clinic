import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SkipPermissions } from 'src/common/decorators';
import { BookingService } from './booking.service.js';
import { BatchCheckoutDto, CheckoutAppointmentDto } from './dtos/checkout-appointment.dto.js';

@ApiTags('Bookings')
@ApiBearerAuth('access-token')
@Controller('bookings')
@SkipPermissions()
export class BookingController {
  constructor(private readonly bookingService: BookingService) { }

  @Post('checkout')
  @ApiOperation({ summary: 'Giữ chỗ theo thời hạn cấu hình và tạo giao dịch chờ thanh toán' })
  checkout(@Req() request: Request, @Body() dto: CheckoutAppointmentDto) {
    return this.bookingService.checkout(request.user!.id, dto);
  }

  // ─── Batch Checkout (Đặt nhóm / Gia đình) ──────────────────

  @Post('batch-checkout')
  @ApiOperation({ summary: 'Đặt lịch cho nhiều thành viên cùng lúc (All-or-Nothing)' })
  batchCheckout(@Req() request: Request, @Body() dto: BatchCheckoutDto) {
    return this.bookingService.batchCheckout(request.user!.id, dto);
  }

}
