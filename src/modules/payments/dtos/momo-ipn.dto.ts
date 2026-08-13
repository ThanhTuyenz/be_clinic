import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNumber, IsString } from 'class-validator';

export class MomoIpnDto {
  @ApiProperty() @IsString() partnerCode: string;
  @ApiProperty() @IsString() orderId: string;
  @ApiProperty() @IsString() requestId: string;
  @ApiProperty() @IsNumber() amount: number;
  @ApiProperty() @IsString() orderInfo: string;
  @ApiProperty() @IsString() orderType: string;
  @ApiProperty() @IsInt() transId: number;
  @ApiProperty() @IsInt() resultCode: number;
  @ApiProperty() @IsString() message: string;
  @ApiProperty() @IsString() payType: string;
  @ApiProperty() @IsInt() responseTime: number;
  @ApiProperty() @IsString() extraData: string;
  @ApiProperty() @IsString() signature: string;
}
