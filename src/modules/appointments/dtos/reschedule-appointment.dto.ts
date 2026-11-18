import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class RescheduleAppointmentDto {
  @ApiPropertyOptional({ description: 'ID slot bác sĩ mới đã được tạo sẵn', type: Number, minimum: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  newScheduleSlotId?: number;
  @ApiPropertyOptional({ description: 'ID khung tiếp nhận gói khám mới', type: Number, minimum: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  newReceptionSlotId?: number;

  @ApiPropertyOptional({ description: 'Lý do đổi lịch' })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Lý do không được vượt quá 500 ký tự' })
  reason?: string;
}
