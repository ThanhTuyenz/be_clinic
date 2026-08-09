import { Controller, Get, Patch, Post, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import {
  cancelAppointment as legacyCancelAppointment,
  createAppointment as legacyCreateAppointment,
  getDoctorScheduleDates as legacyGetDoctorScheduleDates,
  listMyAppointments as legacyListMyAppointments,
} from '../../src/controllers/appointmentsController.js'
import { SkipPermissions } from '../modules/permissions/decorators/skip-permissions.decorator.js'
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import {
  CancelAppointmentSwaggerDto,
  CreateAppointmentSwaggerDto,
  CreateReceptionAppointmentSwaggerDto,
  UpdateAppointmentStatusSwaggerDto,
} from './dtos/appointment.swagger.dto.js'
import { StaffAppointmentsService } from '../modules/appointments/staff-appointments.service.js'

@ApiTags('Appointments')
@ApiBearerAuth('access-token')
@Controller('appointments')
@SkipPermissions()
export class AppointmentsController {
  constructor(private readonly staffAppointments: StaffAppointmentsService) {}

  @Get('my')
  @ApiOperation({ summary: 'Danh sách lịch khám của bệnh nhân hiện tại' })
  @ApiResponse({ status: 200, description: 'Danh sách lịch khám' })
  listMyAppointments(@Req() req: Request, @Res() res: Response) {
    return legacyListMyAppointments(req, res)
  }

  @Get('doctor')
  @ApiOperation({ summary: 'Danh sách lịch khám của bác sĩ hiện tại' })
  listDoctorAppointments(@Req() req: Request) {
    return this.staffAppointments.doctorAppointments(req.user!.id)
  }

  @Get('lookup-ticket')
  @ApiOperation({ summary: 'Tra cứu lịch khám bằng mã vé (tiếp nhận)' })
  @ApiQuery({ name: 'ticket', example: '260810-ABC123' })
  lookupAppointmentByTicket(@Req() req: Request) {
    return this.staffAppointments.lookupTicket(req.user!.id, String(req.query.ticket || ''))
  }

  @Get('patient-by-code')
  @ApiOperation({ summary: 'Tra cứu bệnh nhân bằng mã bệnh nhân' })
  @ApiQuery({ name: 'code' })
  lookupPatientByCode(@Req() req: Request) {
    return this.staffAppointments.patientByCode(req.user!.id, String(req.query.code || ''))
  }

  @Get('patients')
  @ApiOperation({ summary: 'Danh sách bệnh nhân cho bộ phận tiếp nhận' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'patientCode', required: false })
  @ApiQuery({ name: 'name', required: false })
  @ApiQuery({ name: 'phone', required: false })
  listPatientsReception(@Req() req: Request) {
    return this.staffAppointments.patients(req.user!.id, req.query as Record<string, string | undefined>)
  }

  @Get('patient-history')
  @ApiOperation({ summary: 'Lịch sử khám của một bệnh nhân' })
  @ApiQuery({ name: 'patientId' })
  listPatientHistoryReception(@Req() req: Request) {
    return this.staffAppointments.patientHistory(req.user!.id, String(req.query.patientId || ''))
  }

  @Get('reception')
  @ApiOperation({ summary: 'Danh sách lịch khám cho bộ phận tiếp nhận' })
  @ApiQuery({ name: 'from', required: false, example: '2026-08-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-08-31' })
  @ApiQuery({ name: 'status', required: false, enum: ['all', 'pending', 'confirmed', 'cancelled'] })
  @ApiQuery({ name: 'q', required: false, description: 'Từ khóa tìm kiếm' })
  listReceptionAppointments(@Req() req: Request) {
    return this.staffAppointments.receptionAppointments(req.user!.id, req.query as Record<string, string | undefined>)
  }

  @Get('availability')
  @ApiOperation({ summary: 'Lấy các khung giờ còn trống của bác sĩ' })
  @ApiQuery({ name: 'doctorId' })
  @ApiQuery({ name: 'date', example: '2026-08-10' })
  getAvailability(@Req() req: Request) {
    return this.staffAppointments.availability(req.user!.id, String(req.query.doctorId || ''), String(req.query.date || ''))
  }

  @Get('schedule-dates')
  @ApiOperation({ summary: 'Lấy các ngày làm việc của bác sĩ' })
  @ApiQuery({ name: 'doctorId' })
  @ApiQuery({ name: 'from', required: false, example: '2026-08-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-08-31' })
  getDoctorScheduleDates(@Req() req: Request, @Res() res: Response) {
    return legacyGetDoctorScheduleDates(req, res)
  }

  @Post('reception')
  @ApiOperation({ summary: 'Tiếp nhận đặt lịch thay cho bệnh nhân' })
  @ApiBody({ type: CreateReceptionAppointmentSwaggerDto })
  @ApiResponse({ status: 201, description: 'Đặt lịch tại quầy thành công' })
  createAppointmentReception(@Req() req: Request) {
    return this.staffAppointments.createReception(req.user!.id, req.body)
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Cập nhật trạng thái lịch khám' })
  @ApiParam({ name: 'id', description: 'MongoDB ID của lịch khám' })
  @ApiBody({ type: UpdateAppointmentStatusSwaggerDto })
  updateAppointmentStatusReception(@Req() req: Request) {
    return this.staffAppointments.updateStatus(req.user!.id, String(req.params.id), req.body)
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Bệnh nhân hủy lịch khám' })
  @ApiParam({ name: 'id', description: 'MongoDB ID của lịch khám' })
  @ApiBody({ type: CancelAppointmentSwaggerDto })
  cancelAppointment(@Req() req: Request, @Res() res: Response) {
    return legacyCancelAppointment(req, res)
  }

  @Post()
  @ApiOperation({ summary: 'Bệnh nhân đặt lịch khám online' })
  @ApiBody({ type: CreateAppointmentSwaggerDto })
  @ApiResponse({ status: 201, description: 'Đặt lịch thành công' })
  @ApiResponse({ status: 409, description: 'Trùng lịch hoặc khung giờ đã được đặt' })
  createAppointment(@Req() req: Request, @Res() res: Response) {
    return legacyCreateAppointment(req, res)
  }
}
