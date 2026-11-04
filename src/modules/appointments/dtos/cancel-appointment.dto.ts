import { Type } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';

class RefundBankDto {
  @IsOptional() @IsString() @MaxLength(50) bankCode?: string;
  @IsOptional() @IsString() @MaxLength(200) bankName?: string;
  @IsOptional() @Matches(/^\d{6}$/) bankBin?: string;
  @IsString() @Matches(/^\d{6,34}$/) accountNumber: string;
  @IsString() @MaxLength(150) accountName: string;
}

export class CancelAppointmentDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @IsOptional() @ValidateNested() @Type(() => RefundBankDto) refundBank?: RefundBankDto;
}
