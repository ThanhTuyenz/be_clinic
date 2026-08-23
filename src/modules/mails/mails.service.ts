import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import nodemailer, { Transporter } from 'nodemailer'
import type { AllConfigType, MailerConfig } from '../../config/config.type.js'
import type {
  AppointmentReminderMail,
  ForgotPasswordMail,
  IMailsService,
  RegistrationOtpMail,
  ResetPasswordMail,
} from './mails.js'

@Injectable()
export class MailsService implements IMailsService {
  private readonly logger = new Logger(MailsService.name)
  private readonly config: MailerConfig
  private readonly transporter: Transporter

  constructor(private readonly configService: ConfigService<AllConfigType>) {
    this.config = this.configService.getOrThrow<MailerConfig>('mailer')
    this.transporter = nodemailer.createTransport({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      requireTLS: this.config.requireTLS,
      ignoreTLS: this.config.ignoreTLS,
      auth:
        this.config.user && this.config.password
          ? { user: this.config.user, pass: this.config.password }
          : undefined,
    })
  }

  async confirmRegisterUser(mail: RegistrationOtpMail): Promise<void> {
    const otp = this.escapeHtml(mail.data.otp)
    const name = this.escapeHtml(mail.data.user || 'bạn')
    const minutes = mail.data.expiresInMinutes ?? 10

    await this.send({
      to: mail.to,
      subject: 'Mã OTP xác thực tài khoản VitaCare',
      text: `Xin chào ${mail.data.user || 'bạn'},\n\nMã OTP của bạn là: ${mail.data.otp}\nMã có hiệu lực trong ${minutes} phút.\n\nKhông chia sẻ mã này cho người khác.`,
      html: `<p>Xin chào ${name},</p><p>Mã OTP xác thực tài khoản của bạn:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">${otp}</p><p>Mã có hiệu lực trong ${minutes} phút. Không chia sẻ mã này cho người khác.</p>`,
    })
  }

  async forgotPassword(mail: ForgotPasswordMail): Promise<void> {
    const frontend =
      this.configService.get<string>('app.frontendDomain', { infer: true }) ||
      'http://localhost:3000'
    const resetUrl = `${frontend.replace(/\/$/, '')}/reset-password?hash=${encodeURIComponent(mail.data.hash)}`
    const name = this.escapeHtml(mail.data.user || 'bạn')

    await this.send({
      to: mail.to,
      subject: 'Đặt lại mật khẩu VitaCare',
      text: `Xin chào ${mail.data.user || 'bạn'},\n\nMở liên kết sau để đặt lại mật khẩu: ${resetUrl}`,
      html: `<p>Xin chào ${name},</p><p>Bạn đã yêu cầu đặt lại mật khẩu.</p><p><a href="${this.escapeHtml(resetUrl)}">Đặt lại mật khẩu</a></p><p>Nếu bạn không thực hiện yêu cầu này, hãy bỏ qua email.</p>`,
    })
  }

  async resetPassword(mail: ResetPasswordMail): Promise<void> {
    await this.send({
      to: mail.to,
      subject: 'Mật khẩu VitaCare đã được thay đổi',
      text: 'Mật khẩu tài khoản của bạn đã được thay đổi thành công.',
      html: '<p>Mật khẩu tài khoản của bạn đã được thay đổi thành công.</p>',
    })
  }

  async sendAppointmentReminder(mail: AppointmentReminderMail): Promise<void> {
    const d = mail.data
    const label = d.hoursAhead === 24 ? 'ngày mai' : 'trong 2 giờ nữa'
    const subject = `⏰ Nhắc lịch khám ${label} – ${d.bookingCode}`
    const name = this.escapeHtml(d.patientName)
    const what = d.doctorName
      ? `khám với ${this.escapeHtml(d.doctorName)}`
      : d.serviceName
        ? this.escapeHtml(d.serviceName)
        : 'khám bệnh'

    const html = `
      <p>Xin chào <strong>${name}</strong>,</p>
      <p>Đây là lời nhắc lịch hẹn <strong>${what}</strong> của bạn:</p>
      <table style="border-collapse:collapse;width:100%;max-width:480px">
        <tr><td style="padding:6px 0;color:#666">Mã đặt lịch</td><td><strong>${this.escapeHtml(d.bookingCode)}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#666">Ngày khám</td><td><strong>${d.appointmentDate}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#666">Giờ khám</td><td><strong>${d.startTime}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#666">Địa điểm</td><td>${this.escapeHtml(d.branchName)}${d.branchAddress ? '<br>' + this.escapeHtml(d.branchAddress) : ''}</td></tr>
        ${d.branchPhone ? `<tr><td style="padding:6px 0;color:#666">Điện thoại</td><td>${this.escapeHtml(d.branchPhone)}</td></tr>` : ''}
      </table>
      ${d.medicalNote ? `<p style="background:#fffbe6;border-left:4px solid #f59e0b;padding:12px;margin-top:16px">${this.escapeHtml(d.medicalNote)}</p>` : ''}
      <p style="color:#888;font-size:13px">Nếu cần hỗ trợ, vui lòng liên hệ số điện thoại phòng khám bên trên.</p>
    `

    await this.send({
      to: mail.to,
      subject,
      text: `Nhắc lịch: ${what} – ${d.appointmentDate} lúc ${d.startTime} tại ${d.branchName}. ${d.medicalNote}`,
      html,
    })
  }

  private async send(message: {
    to: string
    subject: string
    text: string
    html: string
  }): Promise<void> {
    if (!this.config.user || !this.config.password) {
      throw new InternalServerErrorException(
        'MAILER_USER hoặc MAILER_PASSWORD chưa được cấu hình',
      )
    }

    try {
      const info = await this.transporter.sendMail({
        from: `"${this.config.defaultName || 'VitaCare Clinic'}" <${this.config.user}>`,
        replyTo: this.config.defaultEmail || this.config.user,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      })
      this.logger.log(`Email sent to ${message.to}, messageId=${info.messageId}`)
    } catch (error) {
      this.logger.error(
        `Unable to send email to ${message.to}`,
        error instanceof Error ? error.stack : undefined,
      )
      throw new InternalServerErrorException('Không thể gửi email. Vui lòng thử lại sau.')
    }
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }
}
