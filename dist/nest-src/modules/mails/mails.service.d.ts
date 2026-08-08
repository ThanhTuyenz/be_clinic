import type { IMailsService } from './mails.js';
export declare class MailsService implements IMailsService {
    confirmRegisterUser(): Promise<any>;
    forgotPassword(): Promise<any>;
    resetPassword(): Promise<any>;
}
