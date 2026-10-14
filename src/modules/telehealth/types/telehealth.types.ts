export interface TelehealthPeer {
  socketId: string;
  userId: string;
  role: 'DOCTOR' | 'PATIENT';
  name: string;
  avatarUrl?: string;
  joinedAt: Date;
  isAudioMuted?: boolean;
  isVideoOff?: boolean;
}

export interface TelehealthRoomState {
  appointmentId: string;
  doctor?: TelehealthPeer;
  patient?: TelehealthPeer;
  startedAt?: Date;
  endedAt?: Date;
  status: 'WAITING' | 'IN_CALL' | 'COMPLETED';
  messages?: ChatMessagePayload[];
}

export interface ChatMessagePayload {
  appointmentId: string;
  senderId: string;
  senderName: string;
  senderRole: 'DOCTOR' | 'PATIENT';
  text: string;
  timestamp: string;
  fileUrl?: string;
}

export interface MediaTogglePayload {
  appointmentId: string;
  isAudioMuted?: boolean;
  isVideoOff?: boolean;
}
