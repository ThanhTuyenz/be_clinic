import { IsNotEmpty, IsOptional, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AuthRegisterDto {
  @ApiProperty({ example: 'vuminhduc.contact@gmail.com hoặc 0946135382' })
  @IsNotEmpty({ message: 'Vui lòng nhập email hoặc số điện thoại.' })
  email: string;

  @ApiProperty({ example: '12345678' })
  @MinLength(6, { message: 'Mật khẩu phải có tối thiểu 6 ký tự.' })
  password: string;

  @ApiProperty({ example: 'Nguyễn Văn A' })
  @IsNotEmpty({ message: 'Vui lòng nhập họ và tên.' })
  fullName: string;

  @IsOptional()
  phoneNumber?: string;
}

