export function sendOtpEmail(to: any, otp: any, recipientName: any): Promise<{
    sent: boolean;
    devLog: boolean;
} | {
    sent: boolean;
    devLog?: undefined;
}>;
export function sendForgotPasswordOtpEmail(to: any, otp: any, recipientName: any): Promise<{
    sent: boolean;
    devLog: boolean;
} | {
    sent: boolean;
    devLog?: undefined;
}>;
export function sendRegistrationOtpEmail({ to, recipientName, otp, expiresInMinutes, }: {
    to: any;
    recipientName: any;
    otp: any;
    expiresInMinutes?: number;
}): Promise<{
    sent: boolean;
    devLog: boolean;
} | {
    sent: boolean;
    devLog?: undefined;
}>;
export function sendAppointmentConfirmationEmail({ to, recipientName, ticket, appointmentDate, startTime, doctorName, specialtyName, }: {
    to: any;
    recipientName: any;
    ticket: any;
    appointmentDate: any;
    startTime: any;
    doctorName: any;
    specialtyName: any;
}): Promise<{
    sent: boolean;
    devLog: boolean;
} | {
    sent: boolean;
    devLog?: undefined;
}>;
