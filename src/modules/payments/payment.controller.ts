import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';

import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import { SkipPermissions } from '../auth/permissions/decorators/skip-permissions.decorator.js';
import { CreatePaymentDto, PayosWebhookDto } from './dtos/payment.dto.js';
import { PaymentService } from './payment.service.js';

@ApiTags('Payments')
@Controller('payments')
@SkipPermissions()
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(private readonly paymentService: PaymentService) {}

  @Public()
  @ApiBearerAuth('access-token')
  @Post('create')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Khởi tạo link thanh toán PayOS (VietQR) cho lịch hẹn' })
  @ApiResponse({ status: 200, description: 'Tạo link thanh toán thành công' })
  @ApiResponse({ status: 400, description: 'Dữ liệu đầu vào không hợp lệ' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy lịch hẹn' })
  async createPayment(@Body() dto: CreatePaymentDto) {
    this.logger.log(`[PayOS] Bắt đầu tạo link thanh toán: appointmentId=${dto.appointmentId}, amount=${dto.amount}`);
    const result = await this.paymentService.createPaymentUrl(
      dto.appointmentId,
      dto.amount,
      dto.description,
    );
    this.logger.log(`[PayOS] Tạo link thành công: orderCode=${result.orderCode}, checkoutUrl=${result.checkoutUrl}`);
    return result;
  }

  @Public()
  @ApiBearerAuth('access-token')
  @Post('simulate-success')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mô phỏng thanh toán thành công (Dành cho Test/Demo)' })
  async simulateSuccess(@Body('paymentId') paymentId: string, @Req() req: any) {
    const accountId = req.user?.id || '';
    return await this.paymentService.simulateSuccess(accountId, paymentId);
  }

  @Public()
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đồng bộ kết quả thanh toán từ cổng PayOS Gateway' })
  async syncPayment(@Body('orderCode') orderCode?: string | number, @Body('appointmentId') appointmentId?: string) {
    const target = orderCode || appointmentId;
    if (!target) {
      return { success: false, message: 'Thiếu orderCode hoặc appointmentId' };
    }
    const result = await this.paymentService.syncPayosPaymentStatus(target);
    return {
      success: true,
      data: result,
    };
  }

  @Public()
  @Get('banks')
  @ApiOperation({ summary: 'Lấy danh sách các ngân hàng hỗ trợ VietQR (logo, mã BIN)' })
  async getBanks() {
    const banks = await this.paymentService.getBanks();
    return {
      success: true,
      data: banks,
    };
  }

  @Public()
  @Post('bank-lookup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Tra cứu tên chủ tài khoản thụ hưởng qua Napas 247' })
  async lookupBank(@Body() body: { bin: string; accountNumber: string }) {
    return await this.paymentService.lookupBankAccount(body?.bin, body?.accountNumber);
  }

  @Public()
  @Post('payos-webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Endpoint nhận IPN Webhook tự động từ PayOS' })
  @ApiResponse({ status: 200, description: 'Xử lý webhook thành công' })
  @ApiResponse({ status: 400, description: 'Chữ ký checksum không hợp lệ' })
  async handlePayosWebhook(@Body() webhookBody: PayosWebhookDto) {
    this.logger.log(`Nhận Webhook từ PayOS: Code [${webhookBody?.code}]`);

    // 1. Xác thực chữ ký dữ liệu để đảm bảo an toàn
    const verifiedData = await this.paymentService.verifyWebhookData(webhookBody);

    // 2. Kiểm tra nếu giao dịch thanh toán thành công (code '00')
    if (webhookBody.code === '00' && verifiedData?.orderCode) {
      await this.paymentService.handleSuccessfulPayment(
        verifiedData.orderCode,
        verifiedData.reference,
        webhookBody,
      );
    } else {
      this.logger.warn(
        `Giao dịch PayOS chưa hoàn tất hoặc thất bại. Code: ${webhookBody.code}, Desc: ${webhookBody.desc}`,
      );
    }

    // 3. Phản hồi HTTP 200 để PayOS không retry webhook
    return {
      success: true,
      message: 'Webhook processed successfully',
    };
  }
}
