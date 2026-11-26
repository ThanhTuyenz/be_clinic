import { Body, Controller, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { SkipPermissions } from '../../common/decorators/skip-permissions.decorator.js';
import { ApproveRefundDto } from './dtos/approve-refund.dto.js';
import { RefundApprovalService } from './refund-approval.service.js';

@ApiTags('Refunds')
@ApiBearerAuth('access-token')
@Controller('payments/appointments')
@Roles('BRANCH_MANAGER')
@UseGuards(RolesGuard)
@SkipPermissions()
export class RefundApprovalController {
  constructor(private readonly refunds: RefundApprovalService) {}

  @Post(':id/refund/approve')
  @ApiOperation({ summary: 'Quản lý chi nhánh duyệt khoản hoàn tiền thủ công' })
  approve(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: ApproveRefundDto) {
    return this.refunds.approve(request.user!.id, id, input);
  }

  @Post(':id/refund/complete')
  @ApiOperation({ summary: 'Quản lý chi nhánh xác nhận đã chuyển khoản hoàn tiền' })
  complete(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body?: { note?: string }) {
    return this.refunds.complete(request.user!.id, id, body?.note);
  }
}
