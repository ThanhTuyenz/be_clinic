import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class RescheduleAppointmentDto {
  @ApiProperty({ description: 'ID slot bác sĩ mới (UUID hoặc virtual_scheduleId_HH:MM)' })
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng chọn khung giờ khám mới' })
  newScheduleSlotId: string;

  @ApiPropertyOptional({ description: 'Lý do đổi lịch' })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Lý do không được vượt quá 500 ký tự' })
  reason?: string;
}
