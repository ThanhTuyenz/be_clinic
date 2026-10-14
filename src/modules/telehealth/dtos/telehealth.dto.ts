import { IsNotEmpty, IsString, IsIn, IsOptional } from 'class-validator';

export class JoinTelehealthRoomDto {
  @IsString()
  @IsNotEmpty()
  appointmentId: string;

  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsIn(['DOCTOR', 'PATIENT'])
  role: 'DOCTOR' | 'PATIENT';

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  avatarUrl?: string;
}

export class WebRtcSignalDto {
  @IsString()
  @IsNotEmpty()
  appointmentId: string;

  @IsString()
  @IsNotEmpty()
  targetSocketId: string;

  @IsNotEmpty()
  signalData: any; // SDP offer/answer hoặc ICE candidate
}

export class TelehealthChatMessageDto {
  @IsString()
  @IsNotEmpty()
  appointmentId: string;

  @IsString()
  @IsNotEmpty()
  text: string;

  @IsString()
  @IsOptional()
  fileUrl?: string;
}
