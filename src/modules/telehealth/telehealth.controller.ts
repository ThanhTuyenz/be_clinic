import { Controller, Get, Param, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipPermissions } from '../../common/decorators/index.js';
import { TelehealthService } from './telehealth.service.js';
import { TelehealthGateway } from './telehealth.gateway.js';

@ApiTags('Telehealth & Online Consultation')
@Controller('telehealth')
@SkipPermissions()
export class TelehealthController {
  constructor(
    private readonly telehealthService: TelehealthService,
    private readonly telehealthGateway: TelehealthGateway,
  ) {}

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
  @ApiOperation({ summary: 'Bác sĩ phụ trách kết thúc phiên tư vấn trực tuyến và lưu hồ sơ' })
  async endRoomSession(
    @Param('appointmentId') appointmentId: string,
    @Req() req: Request,
  ) {
    const session = await this.telehealthService.endRoomSession(appointmentId, {
      endedByUserId: req.user!.id,
    }, req.user!.role);
    this.telehealthGateway.notifyRoomEnded(appointmentId, 'DOCTOR');
    return {
      success: true,
      message: 'Đã kết thúc buổi tư vấn và lưu lịch sử trò chuyện thành công.',
      data: session,
    };
  }

  @Get('room/:appointmentId/session')
  @ApiOperation({ summary: 'Lấy lịch sử phiên tư vấn (thời gian và nội dung chat)' })
  async getSessionHistory(@Req() req: Request, @Param('appointmentId') appointmentId: string) {
    const data = await this.telehealthService.getSessionHistory(appointmentId, req.user!.id, req.user!.role);
    return {
      success: true,
      data,
    };
  }
}
