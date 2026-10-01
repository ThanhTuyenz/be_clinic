import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * DTO yêu cầu khởi tạo link thanh toán PayOS
 */
export class CreatePaymentDto {
  @ApiProperty({
    description: 'Mã định danh lịch hẹn (Appointment ID) hoặc Payment ID',
    example: 'd9b2b3a1-1234-4567-89ab-cdef01234567',
  })
  @IsString({ message: 'appointmentId phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'appointmentId không được để trống' })
  appointmentId: string;

  @ApiProperty({
    description: 'Số tiền thanh toán (VNĐ, tối thiểu 1.000đ)',
    example: 350000,
  })
  @IsNumber({}, { message: 'amount phải là định dạng số' })
  @IsPositive({ message: 'amount phải lớn hơn 0' })
  @Min(1000, { message: 'Số tiền thanh toán tối thiểu là 1.000 VNĐ' })
  amount: number;

  @ApiPropertyOptional({
    description: 'Mô tả nội dung chuyển khoản (tối đa 25 ký tự không dấu)',
    example: 'KHAM CK 1234',
  })
  @IsOptional()
  @IsString()
  @MaxLength(25, { message: 'Nội dung mô tả tối đa 25 ký tự' })
  description?: string;
}

/**
 * Interface cấu trúc dữ liệu bên trong Webhook từ PayOS
 */
export interface PayosWebhookData {
  orderCode: number;
  amount: number;
  description: string;
  accountNumber: string;
  reference: string;
  transactionDateTime: string;
  currency: string;
  paymentLinkId: string;
  code: string;
  desc: string;
}

/**
 * DTO nhận Webhook payload từ PayOS
 */
export class PayosWebhookDto {
  @ApiProperty({ description: 'Mã trạng thái phản hồi', example: '00' })
  @IsNotEmpty()
  code: string;

  @ApiProperty({ description: 'Mô tả trạng thái', example: 'success' })
  @IsNotEmpty()
  desc: string;

  @ApiProperty({ description: 'Dữ liệu chi tiết giao dịch' })
  @IsNotEmpty()
  data: PayosWebhookData;

  @ApiProperty({ description: 'Chữ ký điện tử HMAC_SHA256' })
  @IsNotEmpty()
  signature: string;
}

/**
 * Response trả về cho client sau khi tạo link thanh toán thành công
 */
export interface PaymentLinkResponse {
  orderCode: number;
  amount?: number;
  description?: string;
  accountNumber?: string;
  accountName?: string;
  bin?: string;
  checkoutUrl: string;
  qrCode: string;
  paymentLinkId: string;
}
