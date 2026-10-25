import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  Matches,
  MinLength,
} from 'class-validator';
import { lowerCaseTransformer } from '../../../../common/utils/transformers/lower-case.transformer.js';


export class AuthEmailLoginDto {
  @ApiProperty({ example: 'user@example.com hoặc 0946135382' })
  @IsNotEmpty({ message: 'Vui lòng nhập email hoặc số điện thoại.' })
  email: string;

  @ApiProperty()
  @IsNotEmpty({ message: 'Vui lòng nhập mật khẩu.' })
  password: string;
}

export class AuthRegisterDto {
  @ApiProperty({ example: 'patient@example.com' })
  @Transform(lowerCaseTransformer)
  @IsEmail({}, { message: 'Vui lòng nhập địa chỉ email hợp lệ.' })
  email: string;

  @ApiProperty({ example: '12345678' })
  @MinLength(6, { message: 'Mật khẩu phải có tối thiểu 6 ký tự.' })
  password: string;

  @ApiProperty({ example: 'Nguyễn Văn A' })
  @IsNotEmpty({ message: 'Vui lòng nhập họ và tên.' })
  fullName: string;

  @ApiPropertyOptional({ example: '0912345678' })
  @IsOptional()
  phoneNumber?: string;
}

export class AuthConfirmEmailDto {
  @ApiProperty()
  @IsNotEmpty()
  hash: string;
}

// ==========================================
// 2. Xác thực OTP
// ==========================================

export class AuthVerifyOtpDto {
  @ApiProperty({ example: 'patient@example.com' })
  @Transform(lowerCaseTransformer)
  @IsEmail()
  email: string;

  @ApiProperty({ example: '123456' })
  @IsNotEmpty()
  @Matches(/^\d{6}$/, { message: 'OTP phải gồm đúng 6 chữ số' })
  otp: string;
}

export class AuthResendOtpDto {
  @ApiProperty({ example: 'patient@example.com' })
  @Transform(lowerCaseTransformer)
  @IsEmail()
  email: string;
}

export class AuthForgotPasswordDto {
  @ApiProperty()
  @Transform(lowerCaseTransformer)
  @IsEmail()
  email: string;
}

export class AuthResetPasswordDto {
  @ApiProperty()
  @IsNotEmpty()
  password: string;

  @ApiProperty()
  @IsNotEmpty()
  hash: string;
}

