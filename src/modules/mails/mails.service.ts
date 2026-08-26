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
  BookingConfirmationMail,
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

  async sendBookingConfirmation(mail: BookingConfirmationMail): Promise<void> {
    const d = mail.data
    const subject = `Xác nhận đặt khám thành công – ${d.bookingCode} | VitaCare`
    const name = this.escapeHtml(d.patientName)
    const what = d.doctorName
      ? `Khám với ${this.escapeHtml(d.doctorName)}`
      : d.servicePackageName
        ? this.escapeHtml(d.servicePackageName)
        : 'Khám bệnh'

    const formattedAmount = d.totalAmount != null
      ? new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(d.totalAmount)
      : null

    let attachments: Array<{ filename: string; content: Buffer; cid: string; contentType?: string }> | undefined
    let qrSectionHtml = ''

    if (d.qrCodeDataUrl && d.qrCodeDataUrl.startsWith('data:image/')) {
      const base64Data = d.qrCodeDataUrl.split(',')[1]
      if (base64Data) {
        attachments = [
          {
            filename: 'qr-checkin.png',
            content: Buffer.from(base64Data, 'base64'),
            cid: 'vitacare_qr_checkin',
            contentType: 'image/png',
          },
        ]
        qrSectionHtml = `
          <div style="text-align: center; margin: 20px 0; padding: 16px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px;">
            <div style="font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px;">MÃ QR CHECK-IN TIẾP ĐÓN</div>
            <div style="display: inline-block; padding: 10px; background-color: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px;">
              <img src="cid:vitacare_qr_checkin" alt="Mã QR Check-in" width="160" height="160" style="display: block; width: 160px; height: 160px; margin: 0 auto; background-color: #ffffff;" />
            </div>
            <div style="margin-top: 8px; font-size: 12px; color: #64748b;">Quét mã này tại Kiosk hoặc xuất trình cho Lễ tân khi đến phòng khám</div>
          </div>
        `
      }
    }

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; color: #334155;">
        <!-- Header -->
        <div style="background-color: #0f766e; padding: 20px 24px; text-align: center; color: #ffffff;">
          <div style="font-size: 18px; font-weight: 700; letter-spacing: 0.5px;">PHÒNG KHÁM QUỐC TẾ VITACARE</div>
          <div style="margin-top: 4px; font-size: 13px; opacity: 0.9;">PHIẾU XÁC NHẬN ĐẶT KHÁM</div>
        </div>

        <!-- Body -->
        <div style="padding: 24px;">
          <p style="font-size: 15px; margin: 0 0 12px; color: #0f172a;">Xin chào <strong>${name}</strong>,</p>
          <p style="font-size: 14px; line-height: 1.5; margin: 0 0 16px; color: #475569;">
            Lịch hẹn khám của bạn đã được xác nhận thành công. Dưới đây là thông tin chi tiết:
          </p>

          <!-- Highlight Box: Booking Code & Queue Number -->
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 14px; margin-bottom: 20px; text-align: center;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="text-align: center; width: 50%; border-right: 1px solid #e2e8f0;">
                  <div style="font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase;">Mã đặt khám</div>
                  <div style="font-size: 17px; font-weight: 700; color: #0f766e; margin-top: 2px;">${this.escapeHtml(d.bookingCode)}</div>
                </td>
                <td style="text-align: center; width: 50%;">
                  <div style="font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase;">Số thứ tự dự kiến</div>
                  <div style="font-size: 17px; font-weight: 700; color: #0f766e; margin-top: 2px;">${d.queueNumber != null ? '#' + String(d.queueNumber).padStart(2, '0') : 'Đang cập nhật'}</div>
                </td>
              </tr>
            </table>
          </div>

          <!-- Appointment Details Table -->
          <table style="width: 100%; border-collapse: collapse; font-size: 13.5px; margin-bottom: 16px;">
            <tbody>
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 8px 0; color: #64748b; width: 35%;">Dịch vụ / Bác sĩ:</td>
                <td style="padding: 8px 0; font-weight: 600; color: #0f172a;">${what}</td>
              </tr>
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 8px 0; color: #64748b;">Thời gian khám:</td>
                <td style="padding: 8px 0; font-weight: 600; color: #0f172a;">${d.startTime} – Ngày ${d.appointmentDate}</td>
              </tr>
              ${d.roomName ? `
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 8px 0; color: #64748b;">Phòng khám:</td>
                <td style="padding: 8px 0; font-weight: 600; color: #0f172a;">${this.escapeHtml(d.roomName)}</td>
              </tr>
              ` : ''}
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 8px 0; color: #64748b;">Cơ sở:</td>
                <td style="padding: 8px 0; color: #0f172a; font-weight: 500;">${this.escapeHtml(d.branchName)}</td>
              </tr>
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 8px 0; color: #64748b;">Địa chỉ:</td>
                <td style="padding: 8px 0; color: #334155;">${this.escapeHtml(d.branchAddress)}</td>
              </tr>
              ${d.branchPhone ? `
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 8px 0; color: #64748b;">Hotline hỗ trợ:</td>
                <td style="padding: 8px 0; color: #334155;">${this.escapeHtml(d.branchPhone)}</td>
              </tr>
              ` : ''}
              ${formattedAmount ? `
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 8px 0; color: #64748b;">Phí khám:</td>
                <td style="padding: 8px 0; font-weight: 600; color: #0f172a;">${formattedAmount} <span style="font-size: 11px; color: #16a34a; font-weight: 600;">(Đã thanh toán)</span></td>
              </tr>
              ` : ''}
            </tbody>
          </table>

          <!-- QR Code Section -->
          ${qrSectionHtml}

          <!-- Notice Box -->
          <div style="background-color: #f8fafc; border-left: 3px solid #0f766e; padding: 12px 14px; border-radius: 0 6px 6px 0; margin-top: 16px; font-size: 12.5px; color: #475569; line-height: 1.5;">
            <div style="font-weight: 600; color: #0f172a; margin-bottom: 4px;">Lưu ý khi đến khám:</div>
            <div style="margin-bottom: 2px;">• Vui lòng có mặt tại cơ sở trước giờ hẹn <strong>15 phút</strong>.</div>
            <div style="margin-bottom: 2px;">• Xuất trình <strong>Mã QR</strong> trên email này hoặc <strong>Mã đặt khám / CCCD</strong> tại Quầy lễ tân.</div>
            <div>• Mang theo các kết quả xét nghiệm, toa thuốc cũ nếu có.</div>
          </div>
        </div>

        <!-- Footer -->
        <div style="background-color: #f8fafc; padding: 14px 20px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 11.5px; color: #94a3b8;">
          <div>Cảm ơn quý khách đã lựa chọn <strong>VitaCare</strong>.</div>
          <div style="margin-top: 2px;">Email này được gửi tự động từ hệ thống.</div>
        </div>
      </div>
    `

    await this.send({
      to: mail.to,
      subject,
      text: `Xác nhận đặt khám thành công: ${what} – ${d.appointmentDate} lúc ${d.startTime} tại ${d.branchName}. Mã đặt khám: ${d.bookingCode}. Số thứ tự: #${d.queueNumber || '---'}`,
      html,
      attachments,
    })
  }

  async sendAppointmentCancellation(mail: import('./mails.js').AppointmentCancellationMail): Promise<void> {
    const d = mail.data
    const isPatient = d.cancelledBy === 'PATIENT'
    const subject = isPatient
      ? `[VitaCare] Xác nhận hủy lịch khám – Mã: ${d.bookingCode}`
      : `[VitaCare] Thông báo hủy lịch khám từ phòng khám – Mã: ${d.bookingCode}`

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 580px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
        <!-- Header -->
        <div style="background: ${isPatient ? '#475569' : '#b91c1c'}; padding: 18px 24px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 18px; font-weight: 700; letter-spacing: -0.3px;">
            ${isPatient ? 'Xác Nhận Hủy Lịch Khám' : 'Thông Báo Hủy Lịch Khám'}
          </h1>
          <p style="color: rgba(255,255,255,0.85); margin: 4px 0 0; font-size: 12px;">Hệ thống Phòng khám Đa khoa VitaCare</p>
        </div>

        <!-- Body -->
        <div style="padding: 20px 24px;">
          <p style="margin: 0 0 14px; font-size: 14px; color: #1e293b; line-height: 1.5;">
            Kính gửi <strong>${d.patientName}</strong>,
          </p>
          <p style="margin: 0 0 16px; font-size: 13px; color: #475569; line-height: 1.5;">
            ${isPatient
              ? `Lịch hẹn khám của quý khách với mã <strong>#${d.bookingCode}</strong> đã được hủy thành công theo yêu cầu.`
              : `Chúng tôi rất tiếc phải thông báo rằng lịch hẹn khám <strong>#${d.bookingCode}</strong> của quý khách đã bị hủy do lý do bất khả kháng từ phòng khám.`}
          </p>

          <!-- Appointment Summary Table -->
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 14px 16px; margin-bottom: 16px;">
            <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
              <tr>
                <td style="padding: 4px 0; color: #64748b; width: 140px;">Mã lịch hẹn:</td>
                <td style="padding: 4px 0; font-weight: 700; color: #0f172a; font-family: monospace;">#${d.bookingCode}</td>
              </tr>
              <tr>
                <td style="padding: 4px 0; color: #64748b;">Dịch vụ / Bác sĩ:</td>
                <td style="padding: 4px 0; font-weight: 600; color: #0f172a;">${d.doctorOrServiceName}</td>
              </tr>
              <tr>
                <td style="padding: 4px 0; color: #64748b;">Thời gian:</td>
                <td style="padding: 4px 0; font-weight: 600; color: #0f172a;">${d.startTime} ngày ${d.appointmentDate}</td>
              </tr>
              <tr>
                <td style="padding: 4px 0; color: #64748b;">Cơ sở khám:</td>
                <td style="padding: 4px 0; color: #334155;">${d.branchName}</td>
              </tr>
              ${d.cancelReason ? `
              <tr>
                <td style="padding: 4px 0; color: #64748b;">Lý do hủy:</td>
                <td style="padding: 4px 0; color: #b91c1c; font-weight: 500;">${d.cancelReason}</td>
              </tr>` : ''}
            </table>
          </div>

          <!-- Refund Note -->
          ${d.refundStatusNote ? `
          <div style="background-color: #eff6ff; border-left: 3px solid #3b82f6; padding: 10px 14px; border-radius: 0 6px 6px 0; margin-bottom: 16px; font-size: 12.5px; color: #1e40af; line-height: 1.5;">
            <strong>Thông tin hoàn tiền:</strong> ${d.refundStatusNote}
          </div>` : ''}

          <p style="margin: 0; font-size: 12.5px; color: #64748b; line-height: 1.5;">
            Nếu quý khách có bất kỳ thắc mắc nào hoặc muốn đặt lại lịch mới, xin vui lòng truy cập website hoặc liên hệ hotline phòng khám để được hỗ trợ.
          </p>
        </div>

        <!-- Footer -->
        <div style="background-color: #f8fafc; padding: 12px 20px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 11.5px; color: #94a3b8;">
          <div>VitaCare Clinic · Hotline Hỗ trợ 24/7</div>
        </div>
      </div>
    `

    await this.send({
      to: mail.to,
      subject,
      text: `Thông báo hủy lịch hẹn #${d.bookingCode}: ${d.doctorOrServiceName} ngày ${d.appointmentDate} lúc ${d.startTime}.`,
      html,
    })
  }


  private async send(message: {
    to: string
    subject: string
    text: string
    html: string
    attachments?: Array<{ filename: string; content: Buffer; cid?: string; contentType?: string }>
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
        attachments: message.attachments,
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
