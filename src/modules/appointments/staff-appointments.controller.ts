import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipPermissions } from 'src/common/decorators';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { AppPermission } from '../../common/constants/permissions.constant.js';
import { CreateReceptionAppointmentSwaggerDto, UpdateAppointmentStatusSwaggerDto } from './dtos/appointment.swagger.dto.js';
import { StaffAppointmentsService } from './staff-appointments.service.js';

@ApiTags('Staff appointments')
@ApiBearerAuth('access-token')
@Controller('appointments')
@SkipPermissions()
export class StaffAppointmentsController {
  constructor(private readonly staffAppointments: StaffAppointmentsService) { }

  @Get('doctor')
  @ApiOperation({ summary: 'Danh sách lịch khám của bác sĩ hiện tại' })
  @ApiQuery({ name: 'date', required: false, example: '2026-08-10' })
  @ApiQuery({ name: 'status', required: false, enum: ['all', 'booked', 'checked_in', 'in_examination', 'completed'] })
  listDoctorAppointments(
    @Req() req: Request,
    @Query('date') date?: string,
    @Query('status') status?: string,
  ) {
    return this.staffAppointments.doctorAppointments(req.user!.id, { date, status });
  }

  @Get('lookup-ticket')
  @ApiOperation({ summary: 'Tra cứu lịch khám bằng mã vé (tiếp nhận)' })
  @ApiQuery({ name: 'ticket', example: '260810-ABC123' })
  lookupAppointmentByTicket(@Req() req: Request) {
    return this.staffAppointments.lookupTicket(req.user!.id, String(req.query.ticket || ''));
  }

  @Get('patient-by-code')
  @ApiOperation({ summary: 'Tra cứu bệnh nhân bằng mã bệnh nhân' })
  @ApiQuery({ name: 'code' })
  lookupPatientByCode(@Req() req: Request) {
    return this.staffAppointments.patientByCode(req.user!.id, String(req.query.code || ''));
  }

  @Get('patients')
  @RequirePermissions(AppPermission.PATIENT_READ)
  @ApiOperation({ summary: 'Danh sách bệnh nhân cho bộ phận tiếp nhận' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'q', required: false, description: 'Từ khóa tìm kiếm nhanh (mã BN, CCCD, họ tên, SĐT, email)' })
  @ApiQuery({ name: 'patientCode', required: false })
  @ApiQuery({ name: 'name', required: false })
  @ApiQuery({ name: 'phone', required: false })
  listPatientsReception(@Req() req: Request) {
    return this.staffAppointments.patients(req.user!.id, req.query as Record<string, string | undefined>);
  }

  @Get('patient-history')
  @RequirePermissions(AppPermission.CLINICAL_READ)
  @ApiOperation({ summary: 'Lịch sử khám của một bệnh nhân' })
  @ApiQuery({ name: 'patientId' })
  listPatientHistoryReception(@Req() req: Request) {
    return this.staffAppointments.patientHistory(req.user!.id, String(req.query.patientId || ''));
  }

  @Get('reception')
  @ApiOperation({ summary: 'Danh sách lịch khám cho bộ phận tiếp nhận' })
  @ApiQuery({ name: 'from', required: false, example: '2026-08-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-08-31' })
  @ApiQuery({ name: 'status', required: false, enum: ['all', 'pending', 'confirmed', 'cancelled'] })
  @ApiQuery({ name: 'q', required: false, description: 'Từ khóa tìm kiếm' })
  listReceptionAppointments(@Req() req: Request) {
    return this.staffAppointments.receptionAppointments(req.user!.id, req.query as Record<string, string | undefined>);
  }

  @Get('availability')
  @ApiOperation({ summary: 'Lấy các khung giờ còn trống của bác sĩ' })
  @ApiQuery({ name: 'doctorId' })
  @ApiQuery({ name: 'date', example: '2026-08-10' })
  getAvailability(@Req() req: Request) {
    return this.staffAppointments.availability(req.user!.id, String(req.query.doctorId || ''), String(req.query.date || ''));
  }

  @Post('reception')
  @ApiOperation({ summary: 'Tiếp nhận đặt lịch thay cho bệnh nhân' })
  @ApiBody({ type: CreateReceptionAppointmentSwaggerDto })
  @ApiResponse({ status: 201, description: 'Đặt lịch tại quầy thành công' })
  createAppointmentReception(@Req() req: Request) {
    return this.staffAppointments.createReception(req.user!.id, req.body);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Cập nhật trạng thái lịch khám' })
  @ApiParam({ name: 'id', description: 'ID của lịch khám' })
  @ApiBody({ type: UpdateAppointmentStatusSwaggerDto })
  updateAppointmentStatusReception(@Req() req: Request) {
    return this.staffAppointments.updateStatus(req.user!.id, String(req.params.id), req.body);
  }

  @Get('next-visit-queue')
  @ApiOperation({ summary: 'Lấy số thứ tự khám tiếp theo' })
  nextQueue(
    @Req() request: Request,
    @Query('appointmentDate') date: string,
    @Query('clinicRoom') room?: string,
    @Query('excludeAppointmentId') excludeId?: string,
  ) {
    return this.staffAppointments.nextQueueNumber(request.user!.id, date, room, excludeId);
  }

  @Post(':id/payment')
  @ApiOperation({ summary: 'Ghi nhận thanh toán tại quầy' })
  payment(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: { method?: string; amount?: number; note?: string },
  ) {
    return this.staffAppointments.recordPayment(request.user!.id, id, body);
  }

  @Patch(':id/finish-visit')
  @ApiOperation({ summary: 'Hoàn tất lượt khám bệnh' })
  finish(@Req() request: Request, @Param('id') id: string) {
    return this.staffAppointments.finishMedicalVisit(request.user!.id, id);
  }

  @Post('doctor-leave/impact-analysis')
  @RequirePermissions(AppPermission.SCHEDULE_UPDATE)
  @ApiOperation({ summary: 'Phân tích ảnh hưởng khi bác sĩ nghỉ phép' })
  doctorLeaveImpact(
    @Req() request: Request,
    @Body() body: { doctorId: string; fromDate: string; toDate: string },
  ) {
    return this.staffAppointments.doctorLeaveImpactAnalysis(request.user!.id, body);
  }

  @Post('doctor-leave/smart-reschedule')
  @RequirePermissions(AppPermission.SCHEDULE_UPDATE)
  @ApiOperation({ summary: 'Thực hiện dời lịch thông minh tự động' })
  smartReschedule(
    @Req() request: Request,
    @Body() body: { items: Array<{ appointmentId: string; newSlotId: string }> },
  ) {
    return this.staffAppointments.executeSmartReschedule(request.user!.id, body);
  }

  @Post(':id/reschedule')
  @ApiOperation({ summary: 'Đổi lịch khám bởi quản trị viên' })
  adminReschedule(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: { newSlotId: string; note?: string },
  ) {
    return this.staffAppointments.adminReschedule(request.user!.id, id, body);
  }
}
