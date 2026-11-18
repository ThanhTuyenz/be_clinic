import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Gender as GenderDto } from '@prisma/client';
import { IsBoolean, IsDateString, IsEnum, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreatePatientProfileDto {
  @ApiProperty() @IsString() @MaxLength(100) fullName: string;
  @ApiProperty({ example: '2000-01-15' })
  @IsDateString({ strict: true, strictSeparator: true }, { message: 'Ngày sinh không hợp lệ. Vui lòng chọn lại ngày sinh.' })
  dateOfBirth: string;
  @ApiProperty({ enum: GenderDto }) @IsEnum(GenderDto) gender: GenderDto;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(20) phoneNumber: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) nationalId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) healthInsuranceNumber?: string;
  
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) provinceCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) provinceName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) wardCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) wardName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() streetAddress?: string;
  @ApiPropertyOptional({ deprecated: true, description: 'Địa chỉ tự do từ client cũ; chuyển sang streetAddress, không lưu riêng.' })
  @IsOptional() @IsString() address?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) ethnicity?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) nationality?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) occupation?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) guardianName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) guardianPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) guardianRelationship?: string;

  @ApiPropertyOptional({ default: 'SELF' }) @IsOptional() @IsString() @MaxLength(50) relationshipToAccount?: string;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() isMainProfile?: boolean;

  @ApiPropertyOptional({ description: 'Tiền sử bệnh mạn tính / bệnh nền' }) @IsOptional() @IsString() medicalHistory?: string;
  @ApiPropertyOptional({ description: 'Tiền sử dị ứng thuốc / thực phẩm' }) @IsOptional() @IsString() allergies?: string;
  @ApiPropertyOptional({ description: 'Bệnh ở người thân, quan hệ và tuổi phát hiện nếu biết' })
  @IsOptional() @IsString() @MaxLength(1000) familyHistory?: string | null;
  @ApiPropertyOptional({ enum: ['UNKNOWN', 'NEVER', 'FORMER', 'OCCASIONAL', 'DAILY'] })
  @IsOptional() @IsIn(['UNKNOWN', 'NEVER', 'FORMER', 'OCCASIONAL', 'DAILY']) smokingStatus?: string | null;
  @ApiPropertyOptional({ enum: ['UNKNOWN', 'NEVER', 'OCCASIONAL', 'FREQUENT'] })
  @IsOptional() @IsIn(['UNKNOWN', 'NEVER', 'OCCASIONAL', 'FREQUENT']) alcoholUse?: string | null;
  @ApiPropertyOptional({ enum: ['UNKNOWN', 'LOW', 'MODERATE', 'HIGH'] })
  @IsOptional() @IsIn(['UNKNOWN', 'LOW', 'MODERATE', 'HIGH']) activityLevel?: string | null;
  @ApiPropertyOptional({ enum: ['UNKNOWN', 'NOT_PREGNANT', 'PREGNANT', 'PLANNING'] })
  @IsOptional() @IsIn(['UNKNOWN', 'NOT_PREGNANT', 'PREGNANT', 'PLANNING']) pregnancyStatus?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isBreastfeeding?: boolean | null;
  @ApiPropertyOptional({ description: 'Nhóm máu (A, B, AB, O, Rh...)' }) @IsOptional() @IsString() @MaxLength(10) bloodGroup?: string;
  @ApiPropertyOptional({ description: 'Chiều cao (cm)' }) @IsOptional() @IsNumber() height?: number;
  @ApiPropertyOptional({ description: 'Cân nặng (kg)' }) @IsOptional() @IsNumber() weight?: number;
}

export class UpdatePatientProfileDto extends PartialType(CreatePatientProfileDto, { skipNullProperties: false }) {}

export class PatientProfileResponseDto {
  @ApiPropertyOptional() familyHistory?: string | null;
  @ApiPropertyOptional() smokingStatus?: string | null;
  @ApiPropertyOptional() alcoholUse?: string | null;
  @ApiPropertyOptional() activityLevel?: string | null;
  @ApiPropertyOptional() pregnancyStatus?: string | null;
  @ApiPropertyOptional() isBreastfeeding?: boolean | null;
  @ApiProperty({ description: 'ID duy nhất của hồ sơ bệnh nhân' })
  id: string;

  @ApiPropertyOptional({ description: 'Mã định danh bệnh nhân (BN26xxxxx)' })
  patientCode?: string | null;

  @ApiProperty({ description: 'ID tài khoản sở hữu' })
  accountId: string;

  @ApiProperty({ description: 'Họ và tên đầy đủ' })
  fullName: string;

  @ApiProperty({ description: 'Ngày tháng năm sinh' })
  dateOfBirth: Date | string;

  @ApiProperty({ enum: GenderDto })
  gender: GenderDto;

  @ApiProperty()
  phoneNumber: string;

  @ApiPropertyOptional({ description: 'Số CCCD / CMND' })
  nationalId?: string | null;

  @ApiPropertyOptional({ description: 'Mã số thẻ BHYT' })
  healthInsuranceNumber?: string | null;

  @ApiPropertyOptional()
  provinceCode?: string | null;

  @ApiPropertyOptional()
  provinceName?: string | null;

  @ApiPropertyOptional()
  wardCode?: string | null;

  @ApiPropertyOptional()
  wardName?: string | null;

  @ApiPropertyOptional()
  streetAddress?: string | null;

  @ApiPropertyOptional({ readOnly: true, description: 'Địa chỉ ghép từ streetAddress và các thành phần hành chính, không lưu riêng.' })
  address?: string | null;

  @ApiPropertyOptional()
  ethnicity?: string | null;

  @ApiPropertyOptional({ default: 'Việt Nam' })
  nationality?: string | null;

  @ApiPropertyOptional()
  occupation?: string | null;

  @ApiPropertyOptional()
  guardianName?: string | null;

  @ApiPropertyOptional()
  guardianPhone?: string | null;

  @ApiPropertyOptional()
  guardianRelationship?: string | null;

  @ApiPropertyOptional({ description: 'Tiền sử bệnh lý mạn tính' })
  medicalHistory?: string | null;

  @ApiPropertyOptional({ description: 'Tiền sử dị ứng' })
  allergies?: string | null;

  @ApiPropertyOptional()
  bloodGroup?: string | null;

  @ApiPropertyOptional()
  height?: number | null;

  @ApiPropertyOptional()
  weight?: number | null;

  @ApiProperty({ description: 'Mối quan hệ với tài khoản (SELF, CHILD, PARENT, SPOUSE, OTHER)' })
  relationshipToAccount: string;

  @ApiProperty({ description: 'Có phải hồ sơ chính hay không' })
  isMainProfile: boolean;

  @ApiProperty()
  createdAt: Date | string;

  @ApiProperty()
  updatedAt: Date | string;
}
