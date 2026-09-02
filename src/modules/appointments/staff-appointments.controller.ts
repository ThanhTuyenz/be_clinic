import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import type { Request } from 'express'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { SkipPermissions } from '../permissions/decorators/skip-permissions.decorator.js'
import { StaffAppointmentsService } from './staff-appointments.service.js'

@ApiTags('Staff appointments')
@ApiBearerAuth('access-token')
@Controller('appointments')
@SkipPermissions()
export class StaffAppointmentsController {
  constructor(private readonly staffAppointments: StaffAppointmentsService) {}

  @Get('next-visit-queue')
  nextQueue(
    @Req() request: Request,
    @Query('appointmentDate') date: string,
    @Query('clinicRoom') room?: string,
    @Query('excludeAppointmentId') excludeId?: string,
  ) {
    return this.staffAppointments.nextQueueNumber(request.user!.id, date, room, excludeId)
  }

  @Post(':id/payment')
  payment(@Req() request: Request, @Param('id') id: string, @Body() body: { method?: string; amount?: number; note?: string }) {
    return this.staffAppointments.recordPayment(request.user!.id, id, body)
  }

  @Patch(':id/finish-visit')
  finish(@Req() request: Request, @Param('id') id: string) {
    return this.staffAppointments.finishMedicalVisit(request.user!.id, id)
  }

  @Post('doctor-leave/impact-analysis')
  doctorLeaveImpact(
    @Req() request: Request,
    @Body() body: { doctorId: string; fromDate: string; toDate: string },
  ) {
    return this.staffAppointments.doctorLeaveImpactAnalysis(request.user!.id, body)
  }

  @Post('doctor-leave/smart-reschedule')
  smartReschedule(
    @Req() request: Request,
    @Body() body: { items: Array<{ appointmentId: string; newSlotId: string }> },
  ) {
    return this.staffAppointments.executeSmartReschedule(request.user!.id, body)
  }
}
