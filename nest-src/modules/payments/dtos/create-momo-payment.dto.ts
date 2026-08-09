import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsUUID } from 'class-validator';

export enum MomoPaymentMethod {
  WALLET = 'WALLET',
  ATM = 'ATM',
  CREDIT_CARD = 'CREDIT_CARD',
}

export class CreateMomoPaymentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  paymentId: string;

  @ApiProperty({ enum: MomoPaymentMethod, default: MomoPaymentMethod.WALLET })
  @IsEnum(MomoPaymentMethod)
  paymentMethod: MomoPaymentMethod;
}
