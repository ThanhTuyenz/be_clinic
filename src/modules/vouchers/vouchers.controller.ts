import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { SkipPermissions } from 'src/common/decorators';
import { ValidateVoucherDto } from './dtos/validate-voucher.dto.js';
import { VouchersService } from './vouchers.service.js';

@ApiTags('Vouchers')
@Controller('vouchers')
@SkipPermissions()
export class VouchersController {
  constructor(private readonly vouchersService: VouchersService) {}

  @Public()
  @Get('available')
  @ApiOperation({ summary: 'Lấy danh sách mã giảm giá đang khả dụng' })
  async getAvailable(@Req() req: Request) {
    const accountId = (req as any).user?.id;
    return this.vouchersService.getAvailableVouchers(accountId);
  }

  @Public()
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Kiểm tra và tính toán chiết khấu của mã voucher' })
  async validate(@Req() req: Request, @Body() dto: ValidateVoucherDto) {
    const accountId = (req as any).user?.id;
    return this.vouchersService.validateVoucher(dto.code, dto.subtotal, accountId);
  }
}
