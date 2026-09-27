import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType, ZaloZnsConfig } from '../../config/config.type.js';
import {
  AppointmentReminderZnsData,
  BookingConfirmationZnsData,
  IZaloZnsService,
} from './zalo-zns.interface.js';

@Injectable()
export class ZaloZnsService implements IZaloZnsService {
  private readonly logger = new Logger(ZaloZnsService.name);
  private readonly config: ZaloZnsConfig;
  private readonly brandName = 'VitaCare Clinic';

  constructor(private readonly configService: ConfigService<AllConfigType>) {
    this.config =
      this.configService.get<ZaloZnsConfig>('zaloZns') || {
        enabled: true,
        isSandbox: true,
        templateBookingConfirm: 'VC_BOOKING_CONFIRM',
        templateReminder: 'VC_APPOINTMENT_REMINDER',
        endpoint: 'https://business.openapi.zalo.me/message/template',
      };
  }

  /**
   * Chuẩn hóa số điện thoại người nhận theo quy chuẩn Zalo ZNS:
   * Mã quốc gia 84 + 9 chữ số tiếp theo (ví dụ: 0987654321 -> 84987654321, +84987654321 -> 84987654321)
   */
  private normalizePhoneForZalo(phone: string): string {
    const cleaned = phone.replace(/[\s.+()-]/g, '');
    if (cleaned.startsWith('0')) {
      return `84${cleaned.slice(1)}`;
    }
    if (cleaned.startsWith('84')) {
      return cleaned;
    }
    return `84${cleaned}`;
  }

  /**
   * Gửi tin nhắn ZNS qua Zalo OpenAPI Gateway hoặc mô phỏng qua Sandbox Mock
   */
  private async sendZnsMessage(
    phone: string,
    templateId: string,
    templateData: Record<string, any>,
    templateTitle: string,
  ): Promise<boolean> {
    if (!this.config.enabled) {
      this.logger.debug(`Zalo ZNS is disabled by configuration.`);
      return false;
    }

    const recipientPhone = this.normalizePhoneForZalo(phone);

    // Chế độ Sandbox hoặc chưa cấu hình Access Token ZOA: Mô phỏng gửi ZNS
    if (this.config.isSandbox || !this.config.accessToken) {
      this.logger.log(
        `\n==================== [ZALO ZNS NOTIFICATION (MOCK)] ====================\n` +
          `🏢 BRANDNAME ZOA:  ${this.brandName} [Đã xác minh Tích Vàng]\n` +
          `📱 TO (Zalo Phone): ${recipientPhone}\n` +
          `📋 TEMPLATE:        ${templateTitle} (ID: ${templateId})\n` +
          `📦 TEMPLATE DATA:\n` +
          JSON.stringify(templateData, null, 2)
            .split('\n')
            .map((line) => `   ${line}`)
            .join('\n') +
          `\n========================================================================`,
      );
      return true;
    }

    // Chế độ Production: Gọi trực tiếp Zalo Business OpenAPI
    try {
      const payload = {
        phone: recipientPhone,
        template_id: templateId,
        template_data: templateData,
        tracking_id: `vitacare_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      };

      const res = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          access_token: this.config.accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const resData = (await res.json()) as { error: number; message: string };

      if (resData.error === 0) {
        this.logger.log(
          `[${this.brandName}] Gửi ZNS thành công tới ${recipientPhone} (Template: ${templateId})`,
        );
        return true;
      }

      this.logger.error(
        `[${this.brandName}] Lỗi Zalo ZNS tới ${recipientPhone}: code=${resData.error} msg=${resData.message}`,
      );
      return false;
    } catch (err: any) {
      this.logger.error(
        `[${this.brandName}] Ngoại lệ khi gọi Zalo ZNS API tới ${recipientPhone}: ${err?.message}`,
      );
      return false;
    }
  }

  /**
   * Gửi Zalo ZNS Xác nhận Đặt Lịch Khám Thành Công
   * Hiển thị thương hiệu VitaCare Clinic, Tên bệnh nhân, Mã vé, Ngày khám, Giờ khám, Chi nhánh, Bác sĩ
   */
  async sendBookingConfirmation(
    data: BookingConfirmationZnsData,
  ): Promise<boolean> {
    const templateData = {
      customer_name: data.patientName || 'Quý khách',
      booking_code: data.bookingCode,
      appointment_date: data.appointmentDate,
      appointment_time: data.startTime,
      branch_name: data.branchName,
      branch_address: data.branchAddress || 'Xem chi tiết trên ứng dụng',
      branch_phone: data.branchPhone || '1900 2805',
      doctor_name: data.doctorName || 'Bác sĩ chuyên khoa',
      service_name: data.serviceName || 'Khám bệnh chuyên khoa',
      note: 'Vui lòng đến trước 15 phút và mang theo CCCD/mã hẹn để check-in tự động tại quầy tiếp đón.',
    };

    return this.sendZnsMessage(
      data.to,
      this.config.templateBookingConfirm,
      templateData,
      'XÁC NHẬN ĐẶT LỊCH KHÁM BỆNH THÀNH CÔNG',
    );
  }

  /**
   * Gửi Zalo ZNS Nhắc Lịch Khám (Trước 24h hoặc trước 2h)
   * Giúp bệnh nhân chuẩn bị giấy tờ, không bỏ lỡ ca khám
   */
  async sendAppointmentReminder(
    data: AppointmentReminderZnsData,
  ): Promise<boolean> {
    const labelAhead =
      data.hoursAhead === 24 ? 'ngày mai (24 giờ tới)' : 'hôm nay (2 giờ tới)';

    const templateData = {
      customer_name: data.patientName || 'Quý khách',
      booking_code: data.bookingCode,
      reminder_time: labelAhead,
      appointment_date: data.appointmentDate,
      appointment_time: data.startTime,
      branch_name: data.branchName,
      branch_address: data.branchAddress || 'Xem chi tiết trên ứng dụng',
      doctor_name: data.doctorName || 'Bác sĩ chuyên khoa',
      service_name: data.serviceName || 'Khám chuyên khoa',
      medical_note:
        data.medicalNote ||
        'Vui lòng nhịn ăn sáng nếu có chỉ định xét nghiệm máu. Mang theo CCCD hoặc BHYT.',
    };

    return this.sendZnsMessage(
      data.to,
      this.config.templateReminder,
      templateData,
      `NHẮC LỊCH KHÁM BỆNH (${labelAhead.toUpperCase()})`,
    );
  }
}
