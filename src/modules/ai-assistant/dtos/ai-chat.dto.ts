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
  title?: string;
  specialtyName: string;
  branchId: string;
  branchName: string;
  consultationFee: number;
}

interface PackageCardRecommendation {
  id: string;
  code: string;
  name: string;
  price: number;
  description?: string;
  branchId?: string;
  specialtyId?: number;
  bookingMethodCode?: string;
  branches?: Array<{ id: string; name: string; receptionHours: Array<{ days: number[]; startTime: string; endTime: string }> }>;
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
  selectPackageForSchedule?: boolean;
  doctors?: DoctorCardRecommendation[];
  quickSuggestions?: string[];
  showAppointments?: boolean;
  paymentStatus?: AiPaymentStatusResult;
}
