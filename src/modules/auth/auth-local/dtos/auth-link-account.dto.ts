import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, Matches, MinLength } from 'class-validator';
import { lowerCaseTransformer } from '../../../../common/utils/transformers/lower-case.transformer';

export class CheckPhoneLinkDto {
  @ApiProperty({ example: '0912345678', description: 'Số điện thoại cần kiểm tra liên kết' })
  @IsNotEmpty({ message: 'Số điện thoại không được để trống' })
  phoneNumber: string;
}

export class RequestLinkOtpDto {
  @ApiProperty({ example: '0912345678', description: 'Số điện thoại tài khoản Zalo nhận OTP' })
  @IsNotEmpty({ message: 'Số điện thoại không được để trống' })
  phoneNumber: string;
}

export class ConfirmLinkAccountDto {
  @ApiProperty({ example: '0912345678', description: 'Số điện thoại đã tạo qua Zalo' })
  @IsNotEmpty({ message: 'Số điện thoại không được để trống' })
  phoneNumber: string;

  @ApiProperty({ example: 'patient@example.com', description: 'Email muốn liên kết' })
  @Transform(lowerCaseTransformer)
  @IsEmail({}, { message: 'Email không đúng định dạng' })
  email: string;

  @ApiProperty({ example: '123456', description: 'Mật khẩu muốn thiết lập' })
  @MinLength(6, { message: 'Mật khẩu tối thiểu 6 ký tự' })
  password: string;

  @ApiPropertyOptional({ example: 'Nguyễn Văn A' })
  @IsOptional()
  fullName?: string;

  @ApiProperty({ example: '123456', description: 'Mã xác thực 6 số gửi qua Zalo ZNS' })
  @IsNotEmpty({ message: 'OTP không được để trống' })
  @Matches(/^\d{6}$/, { message: 'OTP phải gồm đúng 6 chữ số' })
  otp: string;
}
