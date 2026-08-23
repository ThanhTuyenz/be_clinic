import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

// ─── DTO cho 1 thành viên (đơn lẻ hoặc 1 phần tử của nhóm) ──
export class AppointmentItemDto {
  @ApiProperty({ format: 'uuid', description: 'Hồ sơ bệnh nhân của thành viên' })
  @IsUUID()
  patientProfileId: string;

  @ApiPropertyOptional({ enum: ['SERVICE_PACKAGE', 'DOCTOR'], default: 'DOCTOR' })
  @IsOptional()
  @IsIn(['SERVICE_PACKAGE', 'DOCTOR'])
  bookingType?: 'SERVICE_PACKAGE' | 'DOCTOR';

  @ApiPropertyOptional({ description: 'ID slot bác sĩ (uuid hoặc virtual_scheduleId_HH:MM)' })
  @IsOptional()
  @IsString()
  scheduleSlotId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  servicePackageId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  servicePackageScheduleSlotId?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  symptomsDescription?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  bookedViaAi?: boolean;
}

// ─── DTO đặt đơn lẻ (backward compat) ───────────────────────
export class CheckoutAppointmentDto extends AppointmentItemDto {}

// ─── DTO đặt nhóm / gia đình ────────────────────────────────
export class BatchCheckoutDto {
  @ApiProperty({
    type: [AppointmentItemDto],
    description: 'Danh sách thành viên cần đặt lịch (1–10 người)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => AppointmentItemDto)
  items: AppointmentItemDto[];

  @ApiPropertyOptional({ enum: ['SINGLE', 'FAMILY'], default: 'FAMILY' })
  @IsOptional()
  @IsIn(['SINGLE', 'FAMILY'])
  groupType?: 'SINGLE' | 'FAMILY';

  @ApiPropertyOptional({ description: 'Ghi chú cho đơn tổng' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
