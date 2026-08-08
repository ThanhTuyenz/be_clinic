import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CheckoutAppointmentDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() patientProfileId: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() scheduleSlotId: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) symptomsDescription?: string;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() bookedViaAi?: boolean;
}
