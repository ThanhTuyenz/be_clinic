import { ArrayMaxSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class AssignBranchManagerDto {
  @IsUUID()
  managerId!: string;

  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  expectedManagerIds!: string[];
}
