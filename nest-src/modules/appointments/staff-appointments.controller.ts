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

  @Patch(':id/finish-exam')
  finish(@Req() request: Request, @Param('id') id: string) {
    return this.staffAppointments.finishExamination(request.user!.id, id)
  }
}
