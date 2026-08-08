import { ConfigService } from '@nestjs/config';
import type { AllConfigType } from '../../config/config.type.js';
import type { ForgotPasswordMail, IMailsService, RegistrationOtpMail, ResetPasswordMail } from './mails.js';
export declare class MailsService implements IMailsService {
    private readonly configService;
    private readonly logger;
    private readonly config;
    private readonly transporter;
    constructor(configService: ConfigService<AllConfigType>);
    confirmRegisterUser(mail: RegistrationOtpMail): Promise<void>;
    forgotPassword(mail: ForgotPasswordMail): Promise<void>;
    resetPassword(mail: ResetPasswordMail): Promise<void>;
    private send;
    private escapeHtml;
}
