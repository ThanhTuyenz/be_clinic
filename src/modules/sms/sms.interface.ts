export interface BookingConfirmationSms {
  to: string;
  patientName?: string;
  bookingCode: string;
  appointmentDate: string;
  startTime: string;
  branchName: string;
  branchPhone?: string;
}

export interface AppointmentReminderSms {
  to: string;
  patientName?: string;
  bookingCode: string;
  hoursAhead: 24 | 2;
  appointmentDate: string;
  startTime: string;
  branchName: string;
  branchPhone?: string;
}

export interface ISmsService {
  sendBookingConfirmation(sms: BookingConfirmationSms): Promise<boolean>;
  sendAppointmentReminder(sms: AppointmentReminderSms): Promise<boolean>;
}
