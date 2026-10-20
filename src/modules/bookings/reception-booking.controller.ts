import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SkipPermissions } from '../../common/decorators/skip-permissions.decorator.js';
import { CreateReceptionAppointmentDto } from './dtos/reception-booking.dto.js';
import { ReceptionBookingService } from './reception-booking.service.js';

@ApiTags('ReceptionBooking')
@ApiBearerAuth('access-token')
@Controller('bookings')
@SkipPermissions()
export class ReceptionBookingController {
  constructor(private readonly bookings: ReceptionBookingService) {}

  @Post('reception')
  @ApiOperation({ summary: 'Đăng ký khám chuyên khoa tại quầy, tính phí theo dịch vụ đã chọn' })
  @ApiBody({ type: CreateReceptionAppointmentDto })
  @ApiResponse({ status: 201, description: 'Đặt lịch tại quầy thành công' })
  createAppointmentReception(@Req() req: Request, @Body() dto: CreateReceptionAppointmentDto) {
    return this.bookings.createReception(req.user!.id, dto);
  }
}
