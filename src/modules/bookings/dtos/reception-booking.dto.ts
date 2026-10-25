import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';

export class CreateReceptionAppointmentDto {
  @ApiProperty({ description: 'ID chuyên khoa', example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  specialtyId: number;

  @ApiProperty({ format: 'uuid', description: 'Dịch vụ khám thuộc chuyên khoa đã chọn' })
  @IsUUID()
  servicePackageId: string;

  @ApiProperty({ format: 'uuid', description: 'Bác sĩ phụ trách thuộc chuyên khoa' })
  @IsUUID()
  doctorId: string;

  @ApiProperty({ format: 'uuid', description: 'ID slot của bác sĩ trong khung giờ đã chọn từ danh sách khả dụng' })
  @IsUUID()
  scheduleSlotId: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiProperty({ example: '2026-10-19', description: 'Ngày khám YYYY-MM-DD, cho phép đặt trong ngày tại quầy' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Ngày khám phải có định dạng YYYY-MM-DD' })
  appointmentDate: string;

  @ApiProperty({ example: '08:30', description: 'Giờ bắt đầu HH:mm' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Giờ khám phải có định dạng HH:mm' })
  startTime: string;

  @ApiPropertyOptional({ example: 'Đau đầu kéo dài' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @ApiPropertyOptional({ description: 'Email hoặc số điện thoại bệnh nhân' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  patientEmailOrPhone?: string;

  @ApiPropertyOptional({ type: Object, description: 'Hồ sơ đã chọn hoặc thông tin bệnh nhân mới' })
  @IsOptional()
  @IsObject()
  patient?: Record<string, unknown>;
}

export class ReceptionAvailabilityQueryDto {
  @IsOptional()
  @IsUUID()
  doctorId?: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date: string;

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Giờ khám phải có định dạng HH:mm' })
  startTime?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  specialtyId?: number;

  @IsOptional()
  @IsUUID()
  servicePackageId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;
}
