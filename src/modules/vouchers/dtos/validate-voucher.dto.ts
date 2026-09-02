import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class ValidateVoucherDto {
  @ApiProperty({ description: 'Mã giảm giá (ví dụ: MEDPRO10, CHAOBANMOI)', example: 'CHAOBANMOI' })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({ description: 'Tổng tiền tạm tính của các dịch vụ/gói khám (subtotal)', example: 300000 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  subtotal: number;
}
