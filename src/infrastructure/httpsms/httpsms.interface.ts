export interface BookingConfirmationSmsData {
  to: string;
  patientName?: string;
  bookingCode: string;
  appointmentDate: string;
  startTime: string;
  branchName: string;
  branchAddress?: string;
  branchPhone?: string;
  doctorName?: string;
  serviceName?: string;
}

export interface AppointmentReminderSmsData {
  to: string;
  patientName?: string;
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

export interface OtpSmsData {
  to: string;
  otp: string;
  expiresInMinutes?: number;
}

export interface IHttpSmsService {
  sendBookingConfirmation(data: BookingConfirmationSmsData): Promise<boolean>;
  sendAppointmentReminder(data: AppointmentReminderSmsData): Promise<boolean>;
  sendOtp(data: OtpSmsData): Promise<boolean>;
  sendCustomSms(to: string, message: string): Promise<boolean>;
}
