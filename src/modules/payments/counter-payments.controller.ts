import { ExcludeRoles } from '../../common/decorators/exclude-roles.decorator.js';
import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SkipPermissions } from '../../common/decorators/skip-permissions.decorator.js';
import { CounterPaymentsService } from './counter-payments.service.js';
import { MyCollectionsQueryDto } from './dtos/my-collections-query.dto.js';

@ApiTags('CounterPayments')
@ApiBearerAuth('access-token')
@ExcludeRoles('CHAIN_MANAGER')
@Controller('payments/appointments')
@SkipPermissions()
export class CounterPaymentsController {
  constructor(private readonly payments: CounterPaymentsService) {}

  @Get('my-collections')
  @ApiOperation({ summary: 'Lịch sử và tổng tiền tại quầy do chính nhân viên đăng nhập ghi nhận trong ngày' })
  async myCollections(@Req() request: Request, @Query() query: MyCollectionsQueryDto) {
    return this.payments.myCollections(request.user!.id, query);
  }

  @Post(':id/counter')
  @ApiOperation({ summary: 'Ghi nhận thanh toán tại quầy' })
  payment(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: { method?: string; amount?: number; note?: string },
  ) {
    return this.payments.recordPayment(request.user!.id, id, body);
  }
}
