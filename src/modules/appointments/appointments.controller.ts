import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags
} from '@nestjs/swagger';
import type { Request } from 'express';
import { SkipPermissions } from 'src/common/decorators';
import { AppPermission } from '../../common/constants/permissions.constant.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { AppointmentsService } from './appointments.service.js';
import { UpdateAppointmentStatusSwaggerDto } from './dtos/appointment.swagger.dto.js';

@ApiTags('Appointments')
@ApiBearerAuth('access-token')
@Controller('appointments')
@SkipPermissions()
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) { }

  @Get('doctor')
  @ApiOperation({ summary: 'Danh sách lịch khám của bác sĩ hiện tại' })
  @ApiQuery({ name: 'date', required: false, example: '2026-08-10' })
  @ApiQuery({ name: 'status', required: false, enum: ['all', 'booked', 'checked_in', 'in_examination', 'completed'] })
  listDoctorAppointments(
    @Req() req: Request,
    @Query('date') date?: string,
    @Query('status') status?: string,
  ) {
    return this.appointments.doctorAppointments(req.user!.id, { date, status });
  }

  @Get('lookup-ticket')
  @ApiOperation({ summary: 'Tra cứu chính xác lịch khám bằng mã vé hoặc QR lịch hẹn' })
  @ApiQuery({ name: 'ticket', description: 'Mã vé hoặc token QR dạng VITACARE_CHECKIN:...', example: '260810-ABC123' })
  lookupAppointmentByTicket(@Req() req: Request) {
    return this.appointments.lookupTicket(req.user!.id, String(req.query.ticket || ''));
  }

  @Get('patient-history')
  @RequirePermissions(AppPermission.CLINICAL_READ)
  @ApiOperation({ summary: 'Lịch sử khám của một bệnh nhân' })
  @ApiQuery({ name: 'patientId' })
  listPatientHistoryReception(@Req() req: Request) {
    return this.appointments.patientHistory(req.user!.id, String(req.query.patientId || ''));
  }

  @Get('reception')
  @ApiOperation({ summary: 'Danh sách lịch khám cho bộ phận tiếp nhận' })
  @ApiQuery({ name: 'from', required: false, example: '2026-08-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-08-31' })
  @ApiQuery({ name: 'status', required: false, enum: ['all', 'pending', 'confirmed', 'cancelled'] })
  @ApiQuery({ name: 'q', required: false, description: 'Từ khóa tìm kiếm' })
  listReceptionAppointments(@Req() req: Request) {
    return this.appointments.receptionAppointments(req.user!.id, req.query as Record<string, string | undefined>);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Cập nhật trạng thái lịch khám' })
  @ApiParam({ name: 'id', description: 'ID của lịch khám' })
  @ApiBody({ type: UpdateAppointmentStatusSwaggerDto })
  updateAppointmentStatusReception(@Req() req: Request) {
    return this.appointments.updateStatus(req.user!.id, String(req.params.id), req.body);
  }

  @Patch(':id/finish-visit')
  @ApiOperation({ summary: 'Hoàn tất lượt khám bệnh' })
  finish(@Req() request: Request, @Param('id') id: string) {
    return this.appointments.finishMedicalVisit(request.user!.id, id);
  }

  @Post('doctor-leave/smart-reschedule')
  @RequirePermissions(AppPermission.SCHEDULE_UPDATE)
  @ApiOperation({ summary: 'Thực hiện dời lịch thông minh tự động' })
  smartReschedule(
    @Req() request: Request,
    @Body() body: { items: Array<{ appointmentId: string; newSlotId: string }> },
  ) {
    return this.appointments.executeSmartReschedule(request.user!.id, body);
  }

  @Post(':id/clinic-reschedule')
  @ApiOperation({ summary: 'Đổi lịch khám bởi quản trị viên' })
  adminReschedule(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: { newSlotId: string; note?: string },
  ) {
    return this.appointments.adminReschedule(request.user!.id, id, body);
  }
}
