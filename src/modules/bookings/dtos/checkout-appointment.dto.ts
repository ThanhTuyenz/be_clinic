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
  @IsOptional() @IsUUID() searchId?: string;
  @IsOptional() @IsUUID() sourceViewId?: string;
  @IsOptional() @IsString() @MaxLength(100) analyticsSessionId?: string;
  @ApiProperty({ format: 'uuid', description: 'Hồ sơ bệnh nhân của thành viên' })
  @IsUUID()
  patientProfileId: string;

  @ApiProperty({ description: 'Mã hình thức đặt khám (SPECIALTY_EXAM, CONSULTATION, ONLINE_CONSULTATION, AFTER_HOURS, HEALTH_PACKAGE)' })
  @IsString()
  bookingMethodCode: string;

  @ApiPropertyOptional({ description: 'ID slot bác sĩ đã được tạo sẵn', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  scheduleSlotId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  servicePackageId?: string;

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
export class CheckoutAppointmentDto extends AppointmentItemDto {
  @ApiPropertyOptional({ description: 'Mã giảm giá voucher (nếu có)' })
  @IsOptional()
  @IsString()
  voucherCode?: string;
}

// ─── DTO đặt nhóm / gia đình ────────────────────────────────
export class BatchCheckoutDto {
  @ApiProperty({
    type: [AppointmentItemDto],
    description: 'Danh sách thành viên cần đặt lịch (1–5 người, cùng ngày và cơ sở)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
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

  @ApiPropertyOptional({ description: 'Mã giảm giá voucher (nếu có)' })
  @IsOptional()
  @IsString()
  voucherCode?: string;
}
