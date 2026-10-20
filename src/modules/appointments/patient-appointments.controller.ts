import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { SkipPermissions } from '../../common/decorators/skip-permissions.decorator.js';
import { AppointmentConfirmationService } from './appointment-confirmation.service.js';
import { RescheduleAppointmentDto } from './dtos/reschedule-appointment.dto.js';
import { buildGoogleCalendarUrl, buildIcsContent } from './helpers/calendar.helper.js';
import { PatientAppointmentsService } from './patient-appointments.service.js';

@ApiTags('PatientAppointments')
@ApiBearerAuth('access-token')
@Controller('appointments')
@SkipPermissions()
export class PatientAppointmentsController {
  constructor(private readonly appointments: PatientAppointmentsService, private readonly appointmentConfirmationService: AppointmentConfirmationService) { }

  @Get('my-bookings')
  @ApiOperation({ summary: 'Danh sách lịch khám của tài khoản bệnh nhân' })
  myAppointments(@Req() request: Request) {
    return this.appointments.myAppointments(request.user!.id);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Bệnh nhân tự hủy lịch hẹn' })
  @ApiParam({ name: 'id', format: 'uuid' })
  cancelAppointment(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: { reason?: string; refundBank?: { bankCode?: string; bankName?: string; bankBin?: string; accountNumber?: string; accountName?: string } },
  ) {
    return this.appointments.cancelMyAppointment(request.user!.id, id, body);
  }

  @Post(':id/reschedule')
  @ApiOperation({ summary: 'Bệnh nhân đổi lịch khám sang khung giờ mới' })
  @ApiParam({ name: 'id', format: 'uuid' })
  rescheduleAppointment(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() dto: RescheduleAppointmentDto,
  ) {
    return this.appointments.rescheduleMyAppointment(request.user!.id, id, dto);
  }

  @Get(':id/check-in-pass')
  @ApiOperation({ summary: 'Lấy QR check-in, số thứ tự dự kiến và phòng khám sau thanh toán' })
  checkInPass(@Req() request: Request, @Param('id') id: string) {
    return this.appointmentConfirmationService.issueCheckInPass(id, request.user!.id);
  }

  @Get(':id/google-calendar-url')
  @ApiOperation({ summary: 'Sinh URL thêm lịch hẹn vào Google Calendar' })
  async googleCalendarUrl(@Req() request: Request, @Param('id') id: string) {
    const pass = await this.appointmentConfirmationService.issueCheckInPass(id, request.user!.id);
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
    const pass = await this.appointmentConfirmationService.issueCheckInPass(id, request.user!.id);
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
