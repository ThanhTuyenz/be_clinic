import { Transform } from 'class-transformer'
import { ApiProperty } from '@nestjs/swagger'
import { IsEmail, IsNotEmpty, Matches } from 'class-validator'
import { lowerCaseTransformer } from '../../../../common/utils/transformers/lower-case.transformer'

export class AuthVerifyOtpDto {
  @ApiProperty({ example: 'patient@example.com' })
  @Transform(lowerCaseTransformer)
  @IsEmail()
  email: string

  @ApiProperty({ example: '123456' })
  @IsNotEmpty()
  @Matches(/^\d{6}$/, { message: 'OTP phải gồm đúng 6 chữ số' })
  otp: string
}

export class AuthResendOtpDto {
  @ApiProperty({ example: 'patient@example.com' })
  @Transform(lowerCaseTransformer)
  @IsEmail()
  email: string
}
