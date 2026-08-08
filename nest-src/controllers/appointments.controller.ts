import { Controller, Get, Patch, Post, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import {
  cancelAppointment as legacyCancelAppointment,
  createAppointment as legacyCreateAppointment,
  createAppointmentReception as legacyCreateAppointmentReception,
  getAvailability as legacyGetAvailability,
  getDoctorScheduleDates as legacyGetDoctorScheduleDates,
  listDoctorAppointments as legacyListDoctorAppointments,
  listMyAppointments as legacyListMyAppointments,
  listPatientHistoryReception as legacyListPatientHistoryReception,
  listPatientsReception as legacyListPatientsReception,
  listReceptionAppointments as legacyListReceptionAppointments,
  lookupAppointmentByTicket as legacyLookupAppointmentByTicket,
  lookupPatientByCode as legacyLookupPatientByCode,
  updateAppointmentStatusReception as legacyUpdateAppointmentStatusReception,
} from '../../src/controllers/appointmentsController.js'
import { SkipPermissions } from '../modules/permissions/decorators/skip-permissions.decorator.js'

@Controller('appointments')
@SkipPermissions()
export class AppointmentsController {
  @Get('my')
  listMyAppointments(@Req() req: Request, @Res() res: Response) {
    return legacyListMyAppointments(req, res)
  }

  @Get('doctor')
  listDoctorAppointments(@Req() req: Request, @Res() res: Response) {
    return legacyListDoctorAppointments(req, res)
  }

  @Get('lookup-ticket')
  lookupAppointmentByTicket(@Req() req: Request, @Res() res: Response) {
    return legacyLookupAppointmentByTicket(req, res)
  }

  @Get('patient-by-code')
  lookupPatientByCode(@Req() req: Request, @Res() res: Response) {
    return legacyLookupPatientByCode(req, res)
  }

  @Get('patients')
  listPatientsReception(@Req() req: Request, @Res() res: Response) {
    return legacyListPatientsReception(req, res)
  }

  @Get('patient-history')
  listPatientHistoryReception(@Req() req: Request, @Res() res: Response) {
    return legacyListPatientHistoryReception(req, res)
  }

  @Get('reception')
  listReceptionAppointments(@Req() req: Request, @Res() res: Response) {
    return legacyListReceptionAppointments(req, res)
  }

  @Get('availability')
  getAvailability(@Req() req: Request, @Res() res: Response) {
    return legacyGetAvailability(req, res)
  }

  @Get('schedule-dates')
  getDoctorScheduleDates(@Req() req: Request, @Res() res: Response) {
    return legacyGetDoctorScheduleDates(req, res)
  }

  @Post('reception')
  createAppointmentReception(@Req() req: Request, @Res() res: Response) {
    return legacyCreateAppointmentReception(req, res)
  }

  @Patch(':id/status')
  updateAppointmentStatusReception(@Req() req: Request, @Res() res: Response) {
    return legacyUpdateAppointmentStatusReception(req, res)
  }

  @Patch(':id/cancel')
  cancelAppointment(@Req() req: Request, @Res() res: Response) {
    return legacyCancelAppointment(req, res)
  }

  @Post()
  createAppointment(@Req() req: Request, @Res() res: Response) {
    return legacyCreateAppointment(req, res)
  }
}
