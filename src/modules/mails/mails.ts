export type RegistrationOtpMail = {
  to: string
  data: { otp: string; user?: string; expiresInMinutes?: number }
}

export type ForgotPasswordMail = {
  to: string
  data: { hash: string; user?: string }
}

export type ResetPasswordMail = {
  to: string
}

export type AppointmentReminderMail = {
  to: string
  data: {
    patientName: string
    bookingCode: string
    appointmentDate: string  // YYYY-MM-DD
    startTime: string        // HH:MM
    branchName: string
    branchAddress: string
    branchPhone: string
    doctorName: string | null
    serviceName: string | null
    medicalNote: string
    hoursAhead: 24 | 2
  }
}

export type BookingConfirmationMail = {
  to: string
  data: {
    patientName: string
    patientCode?: string | null
    bookingCode: string
    queueNumber?: number | null
    appointmentDate: string // YYYY-MM-DD
    startTime: string // HH:MM
    branchName: string
    branchAddress: string
    branchPhone: string
    doctorName?: string | null
    servicePackageName?: string | null
    roomName?: string | null
    totalAmount?: number | null
    qrCodeDataUrl?: string | null
    qrToken?: string | null
  }
}

export type AppointmentCancellationMail = {
  to: string
  data: {
    patientName: string
    bookingCode: string
    appointmentDate: string // YYYY-MM-DD
    startTime: string // HH:MM
    branchName: string
    doctorOrServiceName: string
    cancelReason?: string | null
    cancelledBy: 'PATIENT' | 'CLINIC'
    refundStatusNote?: string
  }
}

export interface IMailsService {
  confirmRegisterUser(data: RegistrationOtpMail): Promise<void>
  forgotPassword(data: ForgotPasswordMail): Promise<void>
  resetPassword(data: ResetPasswordMail): Promise<void>
  sendAppointmentReminder(data: AppointmentReminderMail): Promise<void>
  sendBookingConfirmation(data: BookingConfirmationMail): Promise<void>
  sendAppointmentCancellation(data: AppointmentCancellationMail): Promise<void>
}

