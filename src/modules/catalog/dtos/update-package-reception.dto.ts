import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, Min } from 'class-validator';

export class UpdatePackageReceptionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  branchId!: number;

  @IsArray()
  @ArrayMaxSize(7)
  schedules!: { dayOfWeek: number; sessions: string[] }[];
}
