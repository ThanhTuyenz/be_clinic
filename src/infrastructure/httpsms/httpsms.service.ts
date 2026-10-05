import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType, HttpSmsConfig } from '../../config/config.type.js';
import {
  AppointmentReminderSmsData,
  BookingConfirmationSmsData,
  IHttpSmsService,
  OtpSmsData,
} from './httpsms.interface.js';

@Injectable()
export class HttpSmsService implements IHttpSmsService {
  private readonly logger = new Logger(HttpSmsService.name);
  private readonly config: HttpSmsConfig;

  constructor(private readonly configService: ConfigService<AllConfigType>) {
    this.config =
      this.configService.get<HttpSmsConfig>('httpsms') || {
        enabled: true,
        apiKey: undefined,
        fromNumber: '+84987654321',
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
   * Gửi tin nhắn SMS qua httpSMS Gateway
   */
  async sendCustomSms(to: string, message: string): Promise<boolean> {
    return this.sendSms(to, message);
  }

  /**
   * Gửi tin nhắn SMS cốt lõi
   */
  private async sendSms(to: string, content: string): Promise<boolean> {
    if (!this.config.enabled) {
      this.logger.debug('httpSMS is disabled by configuration.');
      return false;
    }

    if (!this.config.apiKey) {
      this.logger.warn('httpSMS is enabled but HTTPSMS_API_KEY is not configured.');
      return false;
    }

    const formattedTo = this.normalizePhone(to);

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
        this.logger.error(
          `[httpSMS] Lỗi gửi SMS tới ${formattedTo}: HTTP ${res.status} - ${errorText}`,
        );
        return false;
      }

      const result = await res.json().catch(() => null);
      this.logger.log(
        `[httpSMS] Gửi thành công tới ${formattedTo} (ID: ${result?.data?.id ?? 'OK'})`,
      );
      return true;
    } catch (err: any) {
      this.logger.error(
        `[httpSMS] Lỗi gửi SMS tới ${formattedTo}: ${err?.message}`,
      );
      return false;
    }
  }

  /**
   * Gửi SMS Xác nhận Đặt Lịch Khám Thành Công (gọn gàng, chuẩn SMS)
   */
  async sendBookingConfirmation(data: BookingConfirmationSmsData): Promise<boolean> {
    const branchAscii = this.toAscii(data.branchName).replace(/^Phong kham\s*/i, 'PK ');
    const phonePart = data.branchPhone ? ` LH:${data.branchPhone}` : '';
    const doctorPart = data.doctorName ? ` BS: ${this.toAscii(data.doctorName)}` : '';
    const content = `[VitaCare] Dat lich TC! Ma:${data.bookingCode}, Gio:${data.startTime} ngay ${data.appointmentDate}, ${branchAscii}.${doctorPart} Mang CCCD/ma hen check-in. Den truoc 15p.${phonePart}`;

    return this.sendSms(data.to, content);
  }

  /**
   * Gửi SMS Nhắc Lịch Hẹn (24h hoặc 2h trước khám)
   */
  async sendAppointmentReminder(data: AppointmentReminderSmsData): Promise<boolean> {
    const label = data.hoursAhead === 24 ? 'ngay mai' : `sau ${data.hoursAhead}h`;
    const branchAscii = this.toAscii(data.branchName).replace(/^Phong kham\s*/i, 'PK ');
    const doctorPart = data.doctorName ? ` voi BS ${this.toAscii(data.doctorName)}` : '';
    const content = `[VitaCare] Nhac lich ${label}: Ma:${data.bookingCode}, Gio:${data.startTime} ngay ${data.appointmentDate} tai ${branchAscii}${doctorPart}. Vui long mang CCCD/ma hen check-in!`;

    return this.sendSms(data.to, content);
  }

  /**
   * Gửi mã OTP SMS
   */
  async sendOtp(data: OtpSmsData): Promise<boolean> {
    const expireMinutes = data.expiresInMinutes ?? 5;
    const content = `[VitaCare] Ma xac thuc OTP cua ban la: ${data.otp}. Ma co hieu luc trong ${expireMinutes} phut. Vui long khong chia se ma nay cho bat ky ai.`;

    return this.sendSms(data.to, content);
  }
}
