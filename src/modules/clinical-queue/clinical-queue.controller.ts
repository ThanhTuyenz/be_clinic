import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import type { Request } from 'express'
import { SkipPermissions } from '../permissions/decorators/skip-permissions.decorator.js'
import { ClinicalQueueService } from './clinical-queue.service.js'

@Controller('clinical-queue') @SkipPermissions()
export class ClinicalQueueController {
  constructor(private readonly service: ClinicalQueueService) {}
  @Get('rooms') rooms(@Req() req: Request) { return this.service.rooms(req.user!.id) }
  @Get('pass/:appointmentId') pass(@Req() req: Request, @Param('appointmentId') id: string) { return this.service.pass(req.user!.id, id) }
  @Get('my-pass/:appointmentId') patientPass(@Req() req: Request, @Param('appointmentId') id: string) { return this.service.patientPass(req.user!.id, id) }
  @Post('receive') receive(@Req() req: Request, @Body() body: { qrPayload: string; roomId: string }) { return this.service.receive(req.user!.id, body.qrPayload, body.roomId) }
  @Get() list(@Req() req: Request, @Query('roomId') roomId: string, @Query('date') date?: string) { return this.service.list(req.user!.id, roomId, date) }
  @Post('orders/:orderId/mock-result') mock(@Req() req: Request, @Param('orderId') id: string) { return this.service.mockResult(req.user!.id, id) }
}
