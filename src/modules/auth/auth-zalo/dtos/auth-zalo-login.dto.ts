import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AuthZaloLoginDto {
  @ApiProperty({ example: 'zalo_access_token_xyz', description: 'Access token được cấp từ Zalo SDK' })
  @IsNotEmpty({ message: 'Zalo accessToken không được để trống' })
  @IsString()
  accessToken: string;

  @ApiPropertyOptional({ example: '0912345678', description: 'Số điện thoại từ Zalo SDK (nếu có)' })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiPropertyOptional({ example: 'Nguyễn Văn A', description: 'Họ tên từ Zalo SDK (nếu có)' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'patient@vitacare.vn', description: 'Email từ Zalo (nếu có)' })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({ example: 'https://photo.zalo.me/...', description: 'Avatar URL từ Zalo (nếu có)' })
  @IsOptional()
  @IsString()
  avatarUrl?: string;
}
