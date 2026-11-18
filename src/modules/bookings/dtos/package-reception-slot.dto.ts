import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

export class CreatePackageReceptionSlotsDto {
  @Type(() => Number) @IsInt() @Min(1) servicePackageId: number;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) from: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) to: string;
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) startTime: string;
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) endTime: string;
  @IsInt() @Min(10) @Max(120) slotDurationMin: number;
  @IsInt() @Min(1) @Max(200) capacity: number;
}
export class UpdatePackageReceptionSlotDto {
  @IsOptional() @IsInt() @Min(1) @Max(200) capacity?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
