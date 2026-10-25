import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayNotEmpty, ArrayUnique, IsArray, IsBoolean, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class DoctorProfileDto {
  @ApiPropertyOptional({ description: 'Các chuyên khoa của bác sĩ', type: [Number] })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  specialtyIds?: number[];

  @ApiPropertyOptional({ description: 'Chuyên khoa chính, phải nằm trong specialtyIds' })
  @IsOptional()
  @IsInt()
  @Min(1)
  primarySpecialtyId?: number;

  @ApiPropertyOptional({ description: 'Phí tư vấn trực tuyến (VNĐ)' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999.99)
  onlineConsultationFee?: number | null;

  @ApiPropertyOptional({ description: 'Nhận tư vấn trực tuyến', default: false })
  @IsOptional()
  @IsBoolean()
  isOnlineConsultationEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Bác sĩ đang hoạt động', default: true })
  @IsOptional()
  @IsBoolean()
  doctorIsActive?: boolean;
}
