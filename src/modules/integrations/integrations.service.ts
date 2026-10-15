import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import nodemailer from 'nodemailer'
import type { MailerConfig, HttpSmsConfig } from '../../config/config.type.js'

type Field = { label: string; configured: boolean; required: boolean; secret: boolean }
type Integration = {
  id: string; name: string; category: 'payment' | 'email' | 'sms' | 'push'
  status: 'configured' | 'incomplete' | 'disabled' | 'built_in'
  description: string; fields: Field[]; notes: string[]; smtpCheck: boolean
}

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name)
  constructor(private readonly config: ConfigService) {}

  private field(label: string, value: unknown, required = true, secret = false): Field {
    return { label, configured: typeof value === 'string' ? value.trim().length > 0 : value !== undefined && value !== null, required, secret }
  }

  overview(role: string) {
    if (String(role).toUpperCase() !== 'ADMIN') throw new ForbiddenException('Chỉ quản trị hệ thống được xem cấu hình tích hợp')
    const mail = this.config.get<MailerConfig>('mailer')
    const sms = this.config.get<HttpSmsConfig>('httpsms')
    const payFields = [
      this.field('Client ID', this.config.get('PAYOS_CLIENT_ID'), true, true),
      this.field('API key', this.config.get('PAYOS_API_KEY'), true, true),
      this.field('Checksum key', this.config.get('PAYOS_CHECKSUM_KEY'), true, true),
      this.field('URL thanh toán thành công', this.config.get('PAYOS_RETURN_URL'), false),
      this.field('URL hủy thanh toán', this.config.get('PAYOS_CANCEL_URL'), false),
    ]
    const mailFields = [
      this.field('Máy chủ SMTP', mail?.host),
      this.field('Cổng SMTP hợp lệ', Number.isInteger(mail?.port) && Number(mail?.port) > 0 && Number(mail?.port) <= 65535 ? mail?.port : undefined),
      this.field('Email người gửi', mail?.defaultEmail),
      this.field('Tên người gửi', mail?.defaultName, false),
      this.field('Tài khoản SMTP', mail?.user, Boolean(mail?.password), true),
      this.field('Mật khẩu SMTP', mail?.password, Boolean(mail?.user), true),
    ]
    const smsFields = [this.field('API key', sms?.apiKey, true, true), this.field('Số điện thoại gửi', sms?.fromNumber), this.field('Địa chỉ gateway', sms?.endpoint)]
    const ready = (fields: Field[]) => fields.every((f) => !f.required || f.configured)
    const items: Integration[] = [
      { id: 'payos', name: 'PayOS', category: 'payment', status: ready(payFields) ? 'configured' : 'incomplete', description: 'Thanh toán trực tuyến và nhận kết quả giao dịch qua webhook.', fields: payFields, smtpCheck: false,
        notes: ['Webhook PayOS: /payments/payos-webhook (thuộc đường dẫn API của backend).', 'Nếu chưa cấu hình URL trả về, dịch vụ dùng URL mặc định localhost:3000.', 'Chưa xác thực khóa hoặc kiểm tra kết nối với PayOS.'] },
      { id: 'smtp', name: 'SMTP Email', category: 'email', status: mail?.enabled === false ? 'disabled' : ready(mailFields) ? 'configured' : 'incomplete', description: 'Gửi email OTP, xác nhận đặt lịch và nhắc lịch khám.', fields: mailFields, smtpCheck: mail?.enabled !== false && ready(mailFields),
        notes: [mail?.secure ? 'Kết nối TLS trực tiếp.' : mail?.requireTLS ? 'Yêu cầu nâng cấp kết nối qua STARTTLS.' : 'Chưa bắt buộc TLS trong cấu hình hiện tại.', 'Kiểm tra SMTP xác minh kết nối và xác thực, không gửi email.'] },
      { id: 'httpsms', name: 'httpSMS', category: 'sms', status: sms?.enabled === false ? 'disabled' : ready(smsFields) ? 'configured' : 'incomplete', description: 'Gửi mã OTP và thông báo đặt lịch qua SMS gateway.', fields: smsFields, smtpCheck: false,
        notes: ['Số gửi và địa chỉ gateway có thể đang dùng giá trị mặc định của hệ thống.', 'Chưa gửi thử hoặc xác minh tài khoản với nhà cung cấp.'] },
      { id: 'expo', name: 'Expo Push', category: 'push', status: 'built_in', description: 'Thông báo đẩy đến ứng dụng di động qua Expo.', fields: [], smtpCheck: false,
        notes: ['Expo SDK được tích hợp sẵn, không yêu cầu khóa trong cấu hình backend hiện tại.', 'Thiết bị cần đăng ký Expo Push Token hợp lệ. Chưa xác minh khả năng nhận thông báo của thiết bị.'] },
    ]
    return { checkedAt: new Date().toISOString(), environment: this.config.get<string>('app.nodeEnv') || 'development', source: 'environment', items }
  }

  async verifySmtp(role: string, actorId: string) {
    const overview = this.overview(role)
    if (!overview.items.find((item) => item.id === 'smtp')?.smtpCheck) throw new BadRequestException('Cấu hình SMTP chưa đầy đủ để kiểm tra kết nối')
    const mail = this.config.getOrThrow<MailerConfig>('mailer')
    const transporter = nodemailer.createTransport({
      host: mail.host, port: mail.port, secure: mail.secure, requireTLS: mail.requireTLS, ignoreTLS: mail.ignoreTLS,
      auth: mail.user && mail.password ? { user: mail.user, pass: mail.password } : undefined,
      connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 5000,
    })
    try {
      await transporter.verify()
      this.logger.log(`SMTP verification succeeded; actor=${actorId}`)
      return { ok: true, checkedAt: new Date().toISOString(), message: 'Kết nối và xác thực SMTP thành công. Chưa gửi email.' }
    } catch {
      // Provider errors can contain credentials. Only return a fixed message.
      this.logger.warn(`SMTP verification failed; actor=${actorId}`)
      return { ok: false, checkedAt: new Date().toISOString(), message: 'Không xác minh được kết nối SMTP. Kiểm tra máy chủ, cổng, thông tin xác thực và kết nối mạng.' }
    } finally { transporter.close() }
  }
}
