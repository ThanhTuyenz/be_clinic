import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class SearchQueryDto {
  @IsOptional()
  @IsUUID()
  searchRequestId?: string;

  @IsOptional()
  @IsString()
  @MinLength(16)
  @MaxLength(100)
  sessionId?: string;

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty({ message: 'Từ khóa tìm kiếm không được để trống' })
  @MinLength(2, { message: 'Từ khóa tìm kiếm phải có ít nhất 2 ký tự' })
  @MaxLength(200, { message: 'Từ khóa tìm kiếm không được vượt quá 200 ký tự' })
  q: string;

  @IsUUID()
  @IsOptional()
  branchId?: string;
}
