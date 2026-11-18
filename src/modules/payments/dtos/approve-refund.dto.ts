import { IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class ApproveRefundDto {
  @IsInt() @Min(1) amount: number;
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(3) @MaxLength(500) note: string;
}
