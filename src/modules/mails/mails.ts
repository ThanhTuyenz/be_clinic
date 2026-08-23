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

export interface IMailsService {
  confirmRegisterUser(data: RegistrationOtpMail): Promise<void>
  forgotPassword(data: ForgotPasswordMail): Promise<void>
  resetPassword(data: ResetPasswordMail): Promise<void>
  sendAppointmentReminder(data: AppointmentReminderMail): Promise<void>
}
