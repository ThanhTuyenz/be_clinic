import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateAppointmentStatusSwaggerDto {
  @ApiProperty({ enum: ['pending', 'confirmed', 'cancelled'] })
  status: 'pending' | 'confirmed' | 'cancelled';

  @ApiPropertyOptional()
  cancelReason?: string;

  @ApiPropertyOptional({ minimum: 1 })
  visitQueueNumber?: number;

  @ApiPropertyOptional()
  note?: string;
}
