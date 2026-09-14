import { IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AuthEmailLoginDto {
  @ApiProperty({ example: 'user@example.com hoặc 0946135382' })
  @IsNotEmpty({ message: 'Vui lòng nhập email hoặc số điện thoại.' })
  email: string;

  @ApiProperty()
  @IsNotEmpty({ message: 'Vui lòng nhập mật khẩu.' })
  password: string;
}

