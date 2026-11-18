import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import type { AiPaymentStatusResult } from '../ai-payment-status.service.js';

export class AiChatMessageDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  message: string;

  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @IsUUID()
  paymentAppointmentId?: string;
}

interface DoctorCardRecommendation {
  id: string;
  fullName: string;
  avatarUrl?: string | null;
  title?: string;
  specialtyName: string;
  branchId: number;
  branchName: string;
  consultationFee: number;
  bookingMethodCode?: 'CONSULTATION' | 'ONLINE_CONSULTATION';
}

interface PackageCardRecommendation {
  id: number;
  code: string;
  name: string;
  price: number;
  description?: string;
  branchId?: number;
  specialtyId?: number;
  bookingMethodCode?: string;
  branches?: Array<{ id: number; name: string; receptionHours: Array<{ days: number[]; startTime: string; endTime: string }> }>;
}

export interface AiAgentBookingProposal {
  id: string;
  expiresAt: string;
  bookingMethodCode: string;
  slotId: number;
  servicePackageId?: number;
  doctorId: string;
  doctorName: string;
  specialtyName: string;
  specialtyId?: number;
  packageName?: string;
  branchId: number;
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
  bookingPreferences?: { date: string | null; period: 'MORNING' | 'AFTERNOON' | 'EVENING' | null; startTime: string | null; branchId: number | null };
  doctors?: DoctorCardRecommendation[];
  quickSuggestions?: string[];
  showAppointments?: boolean;
  paymentStatus?: AiPaymentStatusResult;
}
