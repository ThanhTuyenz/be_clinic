import { IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class AiBookingSessionDto {
  @IsUUID() sessionId: string;
}

export class PrepareAiBookingDto extends AiBookingSessionDto {
  @IsUUID() proposalId: string;
  @IsUUID() patientProfileId: string;
  @IsOptional() @IsString() @MaxLength(50) voucherCode?: string;
}

export class ConfirmAiBookingDto extends AiBookingSessionDto {
  @Type(() => Number)
  @IsInt() quoteId: number;
  @IsIn(['CONSULTATION', 'ONLINE_CONSULTATION', 'SPECIALTY_EXAM', 'AFTER_HOURS'])
  bookingMethodCode: string;
}
