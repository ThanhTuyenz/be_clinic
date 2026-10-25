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
  description?: string
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

export class AiAgentChatDto {
  @IsString()
  @IsNotEmpty({ message: 'Tin nhắn không được để trống' })
  message: string

  @IsString()
  @IsOptional()
  sessionId?: string

  @IsOptional()
  confirmBooking?: boolean

  @IsString()
  @IsOptional()
  selectedSlotId?: string

  @IsString()
  @IsOptional()
  servicePackageId?: string

  @IsString()
  @IsOptional()
  selectedProfileId?: string
}

export interface AiAgentBookingProposal {
  slotId: string
  servicePackageId?: string
  doctorId: string
  doctorName: string
  specialtyName: string
  packageName?: string
  description?: string
  branchId: string
  branchName: string
  date: string
  startTime: string
  endTime: string
  fee: number
  patientProfileId?: string
  patientProfileName?: string
}

export interface AiAgentChatResponse {
  sessionId: string
  message: string
  step: 'GREETING' | 'COLLECTING_INFO' | 'PROPOSED' | 'CONFIRMED' | 'SUCCESS' | 'ERROR'
  proposal?: AiAgentBookingProposal | null
  proposedPackages?: PackageCardRecommendation[]
  missingSlots?: string[]
  quickSuggestions?: string[]
  bookingResult?: {
    appointmentId: string
    bookingCode: string
    totalAmount: number
    holdExpiresAt: string
    paymentId?: string
  } | null
  availableProfiles?: Array<{ id: string; fullName: string; isMain: boolean; relationship: string }>
}
