export type RegistrationOtpMail = {
    to: string;
    data: {
        otp: string;
        user?: string;
        expiresInMinutes?: number;
    };
};
export type ForgotPasswordMail = {
    to: string;
    data: {
        hash: string;
        user?: string;
    };
};
export type ResetPasswordMail = {
    to: string;
};
export interface IMailsService {
    confirmRegisterUser(data: RegistrationOtpMail): Promise<void>;
    forgotPassword(data: ForgotPasswordMail): Promise<void>;
    resetPassword(data: ResetPasswordMail): Promise<void>;
}
