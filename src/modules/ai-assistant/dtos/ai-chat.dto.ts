import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class AiChatMessageDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  message: string;

  @IsOptional()
  @IsUUID()
  sessionId?: string;
}

export interface DoctorCardRecommendation {
  id: string;
  fullName: string;
  title?: string;
  specialtyName: string;
  branchId: string;
  branchName: string;
  consultationFee: number;
}

export interface PackageCardRecommendation {
  id: string;
  code: string;
  name: string;
  price: number;
  description?: string;
  branchId?: string;
  specialtyId?: number;
  bookingMethodCode?: string;
}

export interface AiAgentBookingProposal {
  id: string;
  expiresAt: string;
  bookingMethodCode: string;
  slotId: string;
  servicePackageId?: string;
  doctorId: string;
  doctorName: string;
  specialtyName: string;
  specialtyId?: string;
  packageName?: string;
  branchId: string;
  branchName: string;
  date: string;
  startTime: string;
  endTime: string;
  fee: number;
}

export interface AiAgentChatResponse {
  sessionId: string;
  message: string;
  step: 'GREETING' | 'COLLECTING_INFO' | 'PROPOSED' | 'ERROR';
  proposal?: AiAgentBookingProposal | null;
  proposedPackages?: PackageCardRecommendation[];
  doctors?: DoctorCardRecommendation[];
  quickSuggestions?: string[];
}
