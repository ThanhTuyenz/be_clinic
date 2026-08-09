"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var MailsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MailsService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const nodemailer_1 = __importDefault(require("nodemailer"));
let MailsService = MailsService_1 = class MailsService {
    configService;
    logger = new common_1.Logger(MailsService_1.name);
    config;
    transporter;
    constructor(configService) {
        this.configService = configService;
        this.config = this.configService.getOrThrow('mailer');
        this.transporter = nodemailer_1.default.createTransport({
            host: this.config.host,
            port: this.config.port,
            secure: this.config.secure,
            requireTLS: this.config.requireTLS,
            ignoreTLS: this.config.ignoreTLS,
            auth: this.config.user && this.config.password
                ? { user: this.config.user, pass: this.config.password }
                : undefined,
        });
    }
    async confirmRegisterUser(mail) {
        const otp = this.escapeHtml(mail.data.otp);
        const name = this.escapeHtml(mail.data.user || 'bạn');
        const minutes = mail.data.expiresInMinutes ?? 10;
        await this.send({
            to: mail.to,
            subject: 'Mã OTP xác thực tài khoản VitaCare',
            text: `Xin chào ${mail.data.user || 'bạn'},\n\nMã OTP của bạn là: ${mail.data.otp}\nMã có hiệu lực trong ${minutes} phút.\n\nKhông chia sẻ mã này cho người khác.`,
            html: `<p>Xin chào ${name},</p><p>Mã OTP xác thực tài khoản của bạn:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">${otp}</p><p>Mã có hiệu lực trong ${minutes} phút. Không chia sẻ mã này cho người khác.</p>`,
        });
    }
    async forgotPassword(mail) {
        const frontend = this.configService.get('app.frontendDomain', { infer: true }) ||
            'http://localhost:3000';
        const resetUrl = `${frontend.replace(/\/$/, '')}/reset-password?hash=${encodeURIComponent(mail.data.hash)}`;
        const name = this.escapeHtml(mail.data.user || 'bạn');
        await this.send({
            to: mail.to,
            subject: 'Đặt lại mật khẩu VitaCare',
            text: `Xin chào ${mail.data.user || 'bạn'},\n\nMở liên kết sau để đặt lại mật khẩu: ${resetUrl}`,
            html: `<p>Xin chào ${name},</p><p>Bạn đã yêu cầu đặt lại mật khẩu.</p><p><a href="${this.escapeHtml(resetUrl)}">Đặt lại mật khẩu</a></p><p>Nếu bạn không thực hiện yêu cầu này, hãy bỏ qua email.</p>`,
        });
    }
    async resetPassword(mail) {
        await this.send({
            to: mail.to,
            subject: 'Mật khẩu VitaCare đã được thay đổi',
            text: 'Mật khẩu tài khoản của bạn đã được thay đổi thành công.',
            html: '<p>Mật khẩu tài khoản của bạn đã được thay đổi thành công.</p>',
        });
    }
    async send(message) {
        if (!this.config.user || !this.config.password) {
            throw new common_1.InternalServerErrorException('MAILER_USER hoặc MAILER_PASSWORD chưa được cấu hình');
        }
        try {
            const info = await this.transporter.sendMail({
                from: `"${this.config.defaultName || 'VitaCare Clinic'}" <${this.config.user}>`,
                replyTo: this.config.defaultEmail || this.config.user,
                to: message.to,
                subject: message.subject,
                text: message.text,
                html: message.html,
            });
            this.logger.log(`Email sent to ${message.to}, messageId=${info.messageId}`);
        }
        catch (error) {
            this.logger.error(`Unable to send email to ${message.to}`, error instanceof Error ? error.stack : undefined);
            throw new common_1.InternalServerErrorException('Không thể gửi email. Vui lòng thử lại sau.');
        }
    }
    escapeHtml(value) {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
};
exports.MailsService = MailsService;
exports.MailsService = MailsService = MailsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], MailsService);
//# sourceMappingURL=mails.service.js.map