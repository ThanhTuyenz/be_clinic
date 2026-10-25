import { Controller, Get, Param, Post, Body, Req } from '@nestjs/common';
import { Request } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipPermissions } from '../../common/decorators/index.js';
import { TelehealthService } from './telehealth.service.js';

@ApiTags('Telehealth & Online Consultation')
@Controller('telehealth')
@SkipPermissions()
export class TelehealthController {
  constructor(private readonly telehealthService: TelehealthService) {}

  @Get('room/:appointmentId')
  @ApiOperation({ summary: 'Lấy thông tin chi tiết phòng tư vấn trực tuyến theo appointmentId' })
  async getRoomInfo(@Req() req: Request, @Param('appointmentId') appointmentId: string) {
    const data = await this.telehealthService.getRoomDetails(appointmentId, req.user!.id, req.user!.role);
    return {
      success: true,
      data,
    };
  }

  @Post('room/:appointmentId/end')
  @ApiOperation({ summary: 'Kết thúc phiên tư vấn trực tuyến và lưu chẩn đoán, đơn thuốc, lịch sử chat vào DB' })
  async endRoomSession(
    @Param('appointmentId') appointmentId: string,
    @Body() body: { diagnosis?: string; prescriptionNotes?: string; endedByUserId?: string },
    @Req() req: Request,
  ) {
    const session = await this.telehealthService.endRoomSession(appointmentId, {
      diagnosis: body.diagnosis,
      prescriptionNotes: body.prescriptionNotes,
      endedByUserId: req.user!.id,
      endReason: 'REST',
    }, req.user!.role);
    return {
      success: true,
      message: 'Đã kết thúc buổi tư vấn và lưu hồ sơ bệnh án thành công.',
      data: session,
    };
  }

  @Get('room/:appointmentId/session')
  @ApiOperation({ summary: 'Lấy lịch sử phiên tư vấn (kết quả khám, đơn thuốc, nội dung chat)' })
  async getSessionHistory(@Req() req: Request, @Param('appointmentId') appointmentId: string) {
    const data = await this.telehealthService.getSessionHistory(appointmentId, req.user!.id, req.user!.role);
    return {
      success: true,
      data,
    };
  }
}
