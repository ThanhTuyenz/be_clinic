import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

export class UpdatePackageReceptionDto {
  @IsUUID()
  branchId!: string;

  @IsArray()
  @ArrayMaxSize(7)
  schedules!: { dayOfWeek: number; sessions: string[] }[];
}
