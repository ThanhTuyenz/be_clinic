import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CheckoutAppointmentDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() patientProfileId: string;
  @ApiPropertyOptional({ enum: ['SPECIALTY_SERVICE', 'HEALTH_PACKAGE'], default: 'SPECIALTY_SERVICE' })
  @IsOptional() @IsIn(['SPECIALTY_SERVICE', 'HEALTH_PACKAGE']) bookingType?: 'SPECIALTY_SERVICE' | 'HEALTH_PACKAGE';
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() scheduleSlotId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() specialtyServiceId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() healthPackageId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() healthPackageScheduleSlotId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) symptomsDescription?: string;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() bookedViaAi?: boolean;
}
