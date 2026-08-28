import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'

export class AiChatMessageDto {
  @IsString()
  @IsNotEmpty({ message: 'Tin nhắn không được để trống' })
  @MaxLength(1000, { message: 'Tin nhắn không được vượt quá 1000 ký tự' })
  message: string

  @IsString()
  @IsOptional()
  sessionId?: string

  @IsOptional()
  userLocationLat?: number

  @IsOptional()
  userLocationLng?: number
}

export interface StructuredAiTriageResponse {
  summary: string
  possibleCauses: string[]
  careAdvice: string[]
  isEmergency: boolean
  emergencyReason?: string
  recommendedSpecialtyCodes: string[]
  confidenceScore: number
  disclaimer: string
}

export interface DoctorCardRecommendation {
  id: string
  fullName: string
  title?: string
  avatarUrl?: string
  specialtyName: string
  branchName: string
  consultationFee: number
}

export interface PackageCardRecommendation {
  id: string
  code: string
  name: string
  price: number
  branchName?: string
}

export interface SpecialtyRecommendation {
  id: string
  code: string
  name: string
  description?: string
  iconUrl?: string
}

export interface AiChatResponsePayload {
  sessionId: string
  sanitizedQuery: string
  triage: StructuredAiTriageResponse
  recommendations: {
    specialties: SpecialtyRecommendation[]
    doctors: DoctorCardRecommendation[]
    packages: PackageCardRecommendation[]
  }
}
