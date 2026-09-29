export interface BookingConfirmationZnsData {
  to: string;
  patientName: string;
  bookingCode: string;
  appointmentDate: string;
  startTime: string;
  branchName: string;
  branchAddress?: string;
  branchPhone?: string;
  doctorName?: string;
  serviceName?: string;
  price?: number | string;
}

export interface AppointmentReminderZnsData {
  to: string;
  patientName: string;
  bookingCode: string;
  hoursAhead: 24 | 2;
  appointmentDate: string;
  startTime: string;
  branchName: string;
  branchAddress?: string;
  branchPhone?: string;
  doctorName?: string;
  serviceName?: string;
  medicalNote?: string;
}

export interface OtpZnsData {
  to: string;
  otp: string;
  expiresInMinutes?: number;
  purpose?: 'REGISTER' | 'LINK_ACCOUNT' | 'RESET_PASSWORD';
}

export interface IZaloZnsService {
  sendBookingConfirmation(data: BookingConfirmationZnsData): Promise<boolean>;
  sendAppointmentReminder(data: AppointmentReminderZnsData): Promise<boolean>;
  sendOtp(data: OtpZnsData): Promise<boolean>;
}
