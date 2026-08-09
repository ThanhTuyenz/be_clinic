import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class CreateAppointmentSwaggerDto {
  @ApiProperty({ description: 'MongoDB ID của bác sĩ' })
  doctorId: string

  @ApiProperty({ example: '2026-08-10', description: 'Ngày khám YYYY-MM-DD' })
  appointmentDate: string

  @ApiProperty({ example: '08:30', description: 'Giờ bắt đầu HH:mm' })
  startTime: string

  @ApiPropertyOptional({ example: 'Đau đầu kéo dài' })
  note?: string
}

export class CreateReceptionAppointmentSwaggerDto extends CreateAppointmentSwaggerDto {
  @ApiPropertyOptional({ description: 'Email hoặc số điện thoại bệnh nhân' })
  patientEmailOrPhone?: string

  @ApiPropertyOptional({ type: Object, description: 'Thông tin bệnh nhân mới' })
  patient?: Record<string, unknown>
}

export class UpdateAppointmentStatusSwaggerDto {
  @ApiProperty({ enum: ['pending', 'confirmed', 'cancelled'] })
  status: 'pending' | 'confirmed' | 'cancelled'

  @ApiPropertyOptional()
  cancelReason?: string

  @ApiPropertyOptional({ minimum: 1 })
  visitQueueNumber?: number

  @ApiPropertyOptional()
  clinicRoom?: string

  @ApiPropertyOptional()
  note?: string
}

export class CancelAppointmentSwaggerDto {
  @ApiProperty({ example: 'Không thể đến đúng lịch' })
  cancelReason: string
}
