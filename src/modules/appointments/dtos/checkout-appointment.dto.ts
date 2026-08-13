import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CheckoutAppointmentDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() patientProfileId: string;
  @ApiPropertyOptional({ enum: ['SERVICE_PACKAGE', 'DOCTOR'], default: 'SERVICE_PACKAGE' })
  @IsOptional() @IsIn(['SERVICE_PACKAGE', 'DOCTOR']) bookingType?: 'SERVICE_PACKAGE' | 'DOCTOR';
  @ApiPropertyOptional() @IsOptional() @IsString() scheduleSlotId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() servicePackageId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() servicePackageScheduleSlotId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) symptomsDescription?: string;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() bookedViaAi?: boolean;
}
