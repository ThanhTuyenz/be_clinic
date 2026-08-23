import { Body, Controller, Get, Headers, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { SkipPermissions } from '../permissions/decorators/skip-permissions.decorator.js';
import { buildGoogleCalendarUrl, buildIcsContent } from './helpers/calendar.helper.js';
import { BookingService } from './booking.service.js';
import { BatchCheckoutDto, CheckoutAppointmentDto } from './dtos/checkout-appointment.dto.js';
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

  @Get('my-bookings')
  @ApiOperation({ summary: 'Danh sách lịch khám của tài khoản bệnh nhân' })
  myAppointments(@Req() request: Request) {
    return this.bookingService.myAppointments(request.user!.id);
  }

  @Get(':id/payment-status')
  @ApiOperation({ summary: 'Kiểm tra trạng thái thanh toán/lịch hẹn' })
  @ApiParam({ name: 'id', format: 'uuid' })
  paymentStatus(@Req() request: Request, @Param('id') id: string) {
    return this.bookingService.paymentStatus(id, request.user!.id);
  }

  @Get(':id/check-in-pass')
  @ApiOperation({ summary: 'Lấy QR check-in, số thứ tự dự kiến và phòng khám sau thanh toán' })
  checkInPass(@Req() request: Request, @Param('id') id: string) {
    return this.bookingService.issueCheckInPass(id, request.user!.id);
  }

  // ─── Batch Checkout (Đặt nhóm / Gia đình) ──────────────────
  @Post('batch-checkout')
  @ApiOperation({ summary: 'Đặt lịch cho nhiều thành viên cùng lúc (All-or-Nothing)' })
  batchCheckout(@Req() request: Request, @Body() dto: BatchCheckoutDto) {
    return this.bookingService.batchCheckout(request.user!.id, dto);
  }

  // ─── Gợi ý khung giờ song song / liên tiếp ─────────────────
  @Get('suggest-slots')
  @ApiOperation({ summary: 'Gợi ý slot song song hoặc liên tiếp cho nhóm gia đình' })
  @ApiQuery({ name: 'branchId', required: true })
  @ApiQuery({ name: 'date', required: true, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'memberCount', required: true, description: 'Số thành viên (1-10)' })
  @ApiQuery({ name: 'specialtyId', required: false })
  suggestSlots(
    @Query('branchId') branchId: string,
    @Query('date') date: string,
    @Query('memberCount') memberCount: string,
    @Query('specialtyId') specialtyId?: string,
  ) {
    return this.bookingService.suggestParallelSlots(
      branchId,
      date,
      Number(memberCount) || 1,
      specialtyId ? Number(specialtyId) : undefined,
    );
  }

  // ─── Calendar Sync ──────────────────────────────────────────
  @Get(':id/google-calendar-url')
  @ApiOperation({ summary: 'Sinh URL thêm lịch hẹn vào Google Calendar' })
  async googleCalendarUrl(@Req() request: Request, @Param('id') id: string) {
    const pass = await this.bookingService.issueCheckInPass(id, request.user!.id);
    const url = buildGoogleCalendarUrl({
      appointmentId: pass.appointmentId,
      bookingCode: pass.bookingCode,
      patientName: pass.patient.fullName,
      doctorName: pass.doctor?.fullName ?? null,
      serviceName: pass.healthPackage?.name ?? null,
      branchName: pass.branch.name,
      branchAddress: pass.branch.address ?? '',
      appointmentDate: pass.appointmentDate,
      startTime: pass.startTime,
      endTime: pass.endTime,
    });
    return { url };
  }

  @Get(':id/calendar.ics')
  @ApiOperation({ summary: 'Tải file .ics về lịch cá nhân (Outlook, Apple Calendar...)' })
  async downloadIcs(
    @Req() request: Request,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const pass = await this.bookingService.issueCheckInPass(id, request.user!.id);
    const ics = buildIcsContent({
      appointmentId: pass.appointmentId,
      bookingCode: pass.bookingCode,
      patientName: pass.patient.fullName,
      doctorName: pass.doctor?.fullName ?? null,
      serviceName: pass.healthPackage?.name ?? null,
      branchName: pass.branch.name,
      branchAddress: pass.branch.address ?? '',
      appointmentDate: pass.appointmentDate,
      startTime: pass.startTime,
      endTime: pass.endTime,
    });
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="appointment-${id}.ics"`);
    res.send(ics);
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
    return this.bookingService.checkIn(token, request.user!.id, 'RECEPTIONIST');
  }

  @Post('scan')
  @ApiOperation({ summary: 'Nhân viên tiếp nhận quét QR của bệnh nhân' })
  staffScan(@Req() request: Request, @Body() body: { token: string }) {
    return this.bookingService.checkIn(body.token, request.user!.id, 'RECEPTIONIST');
  }

  @Public()
  @Post('kiosk/scan')
  @ApiOperation({ summary: 'Máy kiosk tự phục vụ quét QR check-in' })
  kioskScan(@Body() body: { token: string }) {
    return this.bookingService.checkIn(body.token, null, 'KIOSK');
  }
}
