import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';

export class BookingSlotsDto {
  @ApiPropertyOptional({ description: 'Mã hình thức đặt khám', example: 'AFTER_HOURS' })
  @IsOptional()
  @IsIn(['SPECIALTY_EXAM', 'CONSULTATION', 'ONLINE_CONSULTATION', 'HEALTH_PACKAGE', 'AFTER_HOURS'])
  bookingMethodCode?: string;

  @ApiPropertyOptional({
    description: 'ID hoặc slug của chi nhánh / cơ sở y tế',
    example: 'cs1-quan-1',
  })
  @IsOptional()
  @IsString()
  branchId?: string | number;

  @ApiPropertyOptional({
    description: 'Ngày khám theo định dạng YYYY-MM-DD',
    example: '2026-10-05',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== '')
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Ngày khám phải có định dạng YYYY-MM-DD' })
  date?: string;

  @ApiPropertyOptional({
    description: 'ID chuyên khoa',
    example: '1',
  })
  @IsOptional()
  @IsString()
  specialtyId?: string;

  @ApiPropertyOptional({
    description: 'ID của bác sĩ',
    example: '1d624ee4-2aef-4b47-b89d-21da764ec5e2',
  })
  @IsOptional()
  @IsString()
  doctorId?: string;

  @ApiPropertyOptional({
    description: 'ID hoặc slug của gói khám / dịch vụ',
    example: 'goi-kham-tong-quat',
  })
  @IsOptional()
  @IsString()
  servicePackageId?: string | number;

  @ApiPropertyOptional({
    description: 'Số ngày tương lai tìm lịch khám khả dụng (mặc định 30, giới hạn từ 7 đến 60 ngày)',
    example: '30',
  })
  @IsOptional()
  @IsString()
  days?: string;
}
