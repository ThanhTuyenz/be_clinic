import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class BookingInitDto {
  @ApiPropertyOptional({
    description: 'Luồng đặt lịch: doctor | specialty | health-package | facility',
    example: 'doctor',
  })
  @IsOptional()
  @IsString()
  flow?: string;

  @ApiPropertyOptional({
    description: 'ID hoặc slug của chi nhánh / cơ sở y tế',
    example: 'cs1-quan-1',
  })
  @IsOptional()
  @IsString()
  branchId?: string;

  @ApiPropertyOptional({
    description: 'ID chuyên khoa',
    example: '1',
  })
  @IsOptional()
  @IsString()
  specialtyId?: string;
}
