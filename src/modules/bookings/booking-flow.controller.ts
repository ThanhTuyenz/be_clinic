import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import { SkipPermissions } from 'src/common/decorators';
import { BookingFlowService } from './booking-flow.service.js';
import { BookingInitDto } from './dtos/booking-init.dto.js';
import { BookingSlotsDto } from './dtos/booking-slots.dto.js';

@ApiTags('Booking Flow (BFF)')
@Public()
@SkipPermissions()
@Controller('booking')
export class BookingFlowController {
  constructor(private readonly flowService: BookingFlowService) { }

  /**
   * API 1: Khởi tạo dữ liệu theo luồng (Bootstrap API)
   * GET /api/v1/booking/init?flow=doctor | specialty | online-consultation | after-hours | family | all
   */
  @Get('init')
  @ApiOperation({
    summary: 'Khởi tạo dữ liệu theo luồng đặt lịch (Bootstrap API - Facade Pattern)',
    description:
      'Dựa vào hình thức đặt lịch, backend gom dữ liệu liên quan và trả về đúng dữ liệu luồng đó cần; all trả danh mục tổng quan.',
  })
  getInit(@Query() dto: BookingInitDto) {
    return this.flowService.getBookingInit(dto);
  }


  //  List khugn gio kha dung

  @Get('slots')
  @ApiOperation({
    summary: 'Tính toán lịch & khung giờ khả dụng (Availability API)',
    description:
      'Tự tra cứu database, lọc theo ngày/bác sĩ/chuyên khoa, gộp các bác sĩ cùng khung giờ và tính sẵn số chỗ còn trống (remainingSlots, isFull).',
  })
  getSlots(@Query() dto: BookingSlotsDto) {
    return this.flowService.getBookingSlots(dto);
  }
}
