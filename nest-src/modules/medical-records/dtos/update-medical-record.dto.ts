import { IsOptional, IsString, MaxLength } from 'class-validator'

export class UpdateMedicalRecordDto {
  @IsOptional()
  @IsString()
  @MaxLength(10)
  bloodType?: string

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  allergies?: string

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  chronicConditions?: string

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  medicalHistory?: string

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  familyHistory?: string

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  surgicalHistory?: string

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string
}
