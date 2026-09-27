import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType, HttpSmsConfig } from '../../config/config.type.js';
import {
  AppointmentReminderSms,
  BookingConfirmationSms,
  ISmsService,
} from './sms.interface.js';

@Injectable()
export class HttpSmsService implements ISmsService {
  private readonly logger = new Logger(HttpSmsService.name);
  private readonly config: HttpSmsConfig;

  constructor(private readonly configService: ConfigService<AllConfigType>) {
    this.config =
      this.configService.get<HttpSmsConfig>('httpsms') || {
        enabled: true,
        apiKey: undefined,
        fromNumber: '+84987654321',
        isSandbox: true,
        endpoint: 'https://api.httpsms.com/v1/messages/send',
      };
  }

  /**
   * Chuẩn hóa số điện thoại Việt Nam sang định dạng quốc tế E.164 (+84...)
   */
  private normalizePhone(phone: string): string {
    const cleaned = phone.replace(/[\s.-]/g, '');
    if (cleaned.startsWith('0')) {
      return `+84${cleaned.slice(1)}`;
    }
    if (cleaned.startsWith('84') && !cleaned.startsWith('+')) {
      return `+${cleaned}`;
    }
    return cleaned;
  }

  /**
   * Chuyển đổi chuỗi tiếng Việt có dấu sang không dấu để tối ưu số ký tự SMS tiêu chuẩn
   */
  private toAscii(str: string): string {
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D');
  }

  /**
   * Gửi tin nhắn SMS qua httpSMS Gateway hoặc Sandbox Mock
   */
  private async sendSms(to: string, content: string): Promise<boolean> {
    if (!this.config.enabled) {
      this.logger.debug(`SMS sending is disabled by configuration.`);
      return false;
    }

    const formattedTo = this.normalizePhone(to);

    // Chế độ Sandbox / Không có API Key -> Mô phỏng thành công
    if (this.config.isSandbox || !this.config.apiKey) {
      this.logger.log(
        `\n==================== [httpSMS Sandbox] ====================\n` +
          `📱 TO:      ${formattedTo}\n` +
          `✉️  LENGTH:  ${content.length} ký tự (1 SMS segment)\n` +
          `📝 CONTENT: ${content}\n` +
          `===========================================================`,
      );
      return true;
    }

    // Chế độ gửi thật qua API httpSMS
    try {
      const res = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'x-api-key': this.config.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          content,
          from: this.config.fromNumber,
          to: formattedTo,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        this.logger.error(`Failed to send SMS to ${formattedTo} via httpSMS: ${res.status} - ${errorText}`);
        return false;
      }

      this.logger.log(`Successfully sent SMS to ${formattedTo} via httpSMS.`);
      return true;
    } catch (err: any) {
      this.logger.error(`Error sending SMS to ${formattedTo}: ${err?.message}`);
      return false;
    }
  }

  /**
   * Gửi SMS Xác nhận Đặt Lịch Khám Thành Công (Cực ngắn <= 130 ký tự, 1 SMS)
   */
  async sendBookingConfirmation(sms: BookingConfirmationSms): Promise<boolean> {
    const branchAscii = this.toAscii(sms.branchName).replace(/^Phong kham\s*/i, 'PK ');
    const phonePart = sms.branchPhone ? ` LH:${sms.branchPhone}` : '';
    const content = `[VitaCare] Dat lich TC! Ma:${sms.bookingCode}, Gio:${sms.startTime} ngay ${sms.appointmentDate}, ${branchAscii}. Mang CCCD/ma hen check-in. Den truoc 15p.${phonePart}`;

    return this.sendSms(sms.to, content);
  }

  /**
   * Gửi SMS Nhắc Lịch Hẹn (24h trước khám - Cực ngắn <= 130 ký tự, 1 SMS)
   */
  async sendAppointmentReminder(sms: AppointmentReminderSms): Promise<boolean> {
    const label = sms.hoursAhead === 24 ? 'ngay mai' : `sau ${sms.hoursAhead}h`;
    const branchAscii = this.toAscii(sms.branchName).replace(/^Phong kham\s*/i, 'PK ');
    const content = `[VitaCare] Nhac lich ${label}: Ma:${sms.bookingCode}, Gio:${sms.startTime} ngay ${sms.appointmentDate} tai ${branchAscii}. Vui long mang CCCD hoac ma hen de check-in!`;

    return this.sendSms(sms.to, content);
  }
}
