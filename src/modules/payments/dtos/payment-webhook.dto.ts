import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';

export class PaymentWebhookDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() paymentId: string;
  @ApiProperty() @IsString() providerTransactionId: string;
  @ApiProperty({ enum: ['SUCCESS', 'FAILED'] }) @IsIn(['SUCCESS', 'FAILED']) status: 'SUCCESS' | 'FAILED';
  @ApiPropertyOptional() @IsOptional() @IsObject() payload?: Record<string, unknown>;
}
