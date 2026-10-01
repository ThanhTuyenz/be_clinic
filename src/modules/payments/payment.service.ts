import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PayOS, WebhookData } from '@payos/node';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { BookingService } from '../bookings/booking.service.js';
import { PaymentLinkResponse } from './dtos/payment.dto.js';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private payOS: PayOS | null = null;
  private readonly returnUrl: string;
  private readonly cancelUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(forwardRef(() => BookingService))
    private readonly bookingService?: BookingService,
  ) {
    const clientId = this.configService.get<string>('PAYOS_CLIENT_ID');
    const apiKey = this.configService.get<string>('PAYOS_API_KEY');
    const checksumKey = this.configService.get<string>('PAYOS_CHECKSUM_KEY');

    if (clientId && apiKey && checksumKey) {
      try {
        this.payOS = new PayOS({ clientId, apiKey, checksumKey });
        this.logger.log('PayOS SDK đã được khởi tạo thành công.');
      } catch (err: any) {
        this.logger.error(`Không thể khởi tạo PayOS SDK: ${err.message}`);
      }
    } else {
      this.logger.warn(
        'Chưa cấu hình đầy đủ biến môi trường PAYOS_CLIENT_ID, PAYOS_API_KEY, PAYOS_CHECKSUM_KEY.',
      );
    }

    this.returnUrl =
      this.configService.get<string>('PAYOS_RETURN_URL') ||
      'http://localhost:3000/booking/success';
    this.cancelUrl =
      this.configService.get<string>('PAYOS_CANCEL_URL') ||
      'http://localhost:3000/booking/cancel';
  }

  /**
   * Helper: Khởi tạo instance PayOS nếu chưa có sẵn
   */
  private getPayOSInstance(): PayOS {
    const clientId = (this.configService.get<string>('PAYOS_CLIENT_ID') || process.env.PAYOS_CLIENT_ID || '').trim();
    const apiKey = (this.configService.get<string>('PAYOS_API_KEY') || process.env.PAYOS_API_KEY || '').trim();
    const checksumKey = (this.configService.get<string>('PAYOS_CHECKSUM_KEY') || process.env.PAYOS_CHECKSUM_KEY || '').trim();

    if (!clientId || !apiKey || !checksumKey) {
      throw new BadRequestException(
        'Chưa cấu hình các khóa PayOS (PAYOS_CLIENT_ID, PAYOS_API_KEY, PAYOS_CHECKSUM_KEY) trong .env',
      );
    }

    this.payOS = new PayOS({ clientId, apiKey, checksumKey });
    return this.payOS;
  }

  /**
   * Helper: Chuẩn hóa description sang tiếng Việt không dấu, tối đa 25 ký tự theo quy định PayOS
   */
  private sanitizeDescription(text: string, orderCode: number): string {
    const clean = text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .trim();

    const result = clean ? clean : `HEN ${orderCode}`;
    return result.slice(0, 25);
  }

  /**
   * Sinh mã orderCode số nguyên dương duy nhất (tối đa 9007199254740991)
   */
  private generateOrderCode(): number {
    const timestampPart = Date.now().toString().slice(-6);
    const randomPart = Math.floor(1000 + Math.random() * 9000).toString();
    return Number(`${timestampPart}${randomPart}`);
  }

  /**
   * Tạo Payment Link PayOS (VietQR) cho lịch hẹn
   */
  async createPaymentUrl(
    appointmentId: string,
    amount: number,
    customDescription?: string,
  ): Promise<PaymentLinkResponse> {
    const payos = this.getPayOSInstance();

    // 1. Kiểm tra lịch hẹn hoặc payment transaction trong DB
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        OR: [
          { id: appointmentId },
          { invoice: { payments: { some: { id: appointmentId } } } },
        ],
      },
      include: {
        invoice: {
          include: {
            payments: true,
          },
        },
      },
    });

    if (!appointment) {
      throw new NotFoundException(`Không tìm thấy lịch hẹn hoặc giao dịch với ID: ${appointmentId}`);
    }

    const orderCode = this.generateOrderCode();
    const description = this.sanitizeDescription(
      customDescription || `KHAM ${orderCode}`,
      orderCode,
    );

    // CHẾ ĐỘ AN TOÀN DEMO/TEST: Ép số tiền thanh toán sang PayOS luôn là 1.000 VNĐ
    // để bạn có thể quét bằng App ngân hàng thật mà không lo bị trừ số tiền lớn.
    const payAmount = Number(this.configService.get<string>('PAYOS_TEST_AMOUNT') || 1000);
    this.logger.warn(
      `[AN TOÀN DEMO] Số tiền gốc ${amount.toLocaleString('vi-VN')} VNĐ được ghi đè thành ${payAmount.toLocaleString('vi-VN')} VNĐ trên link thanh toán PayOS.`,
    );

    const paymentLinkData = {
      orderCode,
      amount: payAmount,
      description,
      returnUrl: `${this.returnUrl}?appointmentId=${appointment.id}&orderCode=${orderCode}`,
      cancelUrl: `${this.cancelUrl}?appointmentId=${appointment.id}&orderCode=${orderCode}`,
    };

    try {
      this.logger.log(
        `Đang tạo link PayOS cho Appointment [${appointment.id}] - OrderCode: ${orderCode} - Số tiền: ${payAmount} VNĐ`,
      );

      // 2. Gọi SDK tạo link thanh toán (hỗ trợ cả paymentRequests.create và createPaymentLink)
      const paymentLink: any = typeof (payos as any).createPaymentLink === 'function'
        ? await (payos as any).createPaymentLink(paymentLinkData)
        : await payos.paymentRequests.create(paymentLinkData);



      // 3. Lưu vết OrderCode và Payment Link vào database
      await this.prisma.$transaction(async (tx) => {
        if (appointment.invoice?.id) {
          const existingPendingPayment = appointment.invoice.payments?.find(
            (p) => p.status === 'PENDING',
          );

          if (existingPendingPayment) {
            await tx.paymentTransaction.update({
              where: { id: existingPendingPayment.id },
              data: {
                provider: 'PAYOS',
                providerTransactionId: String(orderCode),
                method: 'VIETQR',
                amount: amount,
                rawPayload: {
                  orderCode,
                  paymentLinkId: paymentLink.paymentLinkId,
                  checkoutUrl: paymentLink.checkoutUrl,
                  qrCode: paymentLink.qrCode,
                },
              },
            });
          } else {
            await tx.paymentTransaction.create({
              data: {
                invoiceId: appointment.invoice.id,
                amount: amount,
                provider: 'PAYOS',
                providerTransactionId: String(orderCode),
                idempotencyKey: `payos-${orderCode}-${Date.now()}`,
                method: 'VIETQR',
                status: 'PENDING',
                rawPayload: {
                  orderCode,
                  paymentLinkId: paymentLink.paymentLinkId,
                  checkoutUrl: paymentLink.checkoutUrl,
                  qrCode: paymentLink.qrCode,
                },
              },
            });
          }
        }
      });

      return {
        orderCode: paymentLink.orderCode,
        amount: payAmount,
        description,
        accountNumber: paymentLink.accountNumber || '',
        accountName: paymentLink.accountName || '',
        bin: paymentLink.bin || '',
        checkoutUrl: paymentLink.checkoutUrl,
        qrCode: paymentLink.qrCode,
        paymentLinkId: paymentLink.paymentLinkId,
      };
    } catch (error: any) {
      this.logger.error(`Lỗi khi gọi createPaymentLink PayOS: ${error.message}`, error.stack);
      throw new InternalServerErrorException(
        error.message || 'Không thể khởi tạo phiên thanh toán PayOS',
      );
    }
  }

  /**
   * Xác thực chữ ký dữ liệu Webhook từ PayOS
   */
  async verifyWebhookData(webhookBody: any): Promise<any> {
    const payos = this.getPayOSInstance();
    try {
      if (typeof (payos as any).verifyPaymentWebhookData === 'function') {
        return (payos as any).verifyPaymentWebhookData(webhookBody);
      }
      if (payos.webhooks && typeof payos.webhooks.verify === 'function') {
        return await payos.webhooks.verify(webhookBody);
      }
      return webhookBody.data;
    } catch (error: any) {
      this.logger.warn(`Xác thực Webhook PayOS thất bại: ${error.message}`);
      throw new BadRequestException('Dữ liệu webhook PayOS không hợp lệ hoặc sai chữ ký checksum');
    }
  }


  /**
   * Xử lý cập nhật trạng thái sau khi thanh toán thành công
   */
  async handleSuccessfulPayment(orderCode: number, reference: string, rawPayload?: any): Promise<void> {
    this.logger.log(`Xử lý thanh toán thành công PayOS cho OrderCode: ${orderCode}`);

    // Tìm giao dịch thanh toán theo orderCode
    const payment = await this.prisma.paymentTransaction.findFirst({
      where: {
        providerTransactionId: String(orderCode),
      },
      include: {
        invoice: {
          include: {
            appointment: true,
            bookingOrder: {
              include: { appointments: true },
            },
          },
        },
      },
    });

    if (!payment) {
      this.logger.warn(`Không tìm thấy giao dịch thanh toán tương ứng với OrderCode: ${orderCode}`);
      return;
    }

    if (payment.status === 'SUCCESS') {
      this.logger.log(`Giao dịch ${orderCode} đã được xử lý trước đó.`);
      return;
    }

    // Nếu có BookingService, tận dụng flow webhook chuẩn đầy đủ
    if (this.bookingService) {
      await this.bookingService.handlePaymentWebhook('PAYOS', {
        paymentId: payment.id,
        providerTransactionId: String(orderCode),
        status: 'SUCCESS',
        payload: {
          orderCode,
          reference,
          raw: rawPayload,
        },
      });
      return;
    }

    // Fallback: Cập nhật trực tiếp DB
    await this.prisma.$transaction(async (tx) => {
      await tx.paymentTransaction.update({
        where: { id: payment.id },
        data: {
          status: 'SUCCESS',
          paidAt: new Date(),
          rawPayload: {
            ...(payment.rawPayload as object),
            bankReference: reference,
          },
        },
      });

      if (payment.invoiceId) {
        await tx.invoice.update({
          where: { id: payment.invoiceId },
          data: {
            status: 'PAID',
            paidAt: new Date(),
          },
        });
      }

      if (payment.invoice?.appointment?.id) {
        await tx.appointment.update({
          where: { id: payment.invoice.appointment.id },
          data: {
            status: 'CONFIRMED',
          },
        });
      }
    });

    this.logger.log(`Đã cập nhật thành công trạng thái đơn cho OrderCode: ${orderCode}`);
  }

  /**
   * Mô phỏng thanh toán thành công (Dành cho Test / Demo khi không quét mã QR)
   */
  async simulateSuccess(accountId: string, paymentIdOrAppointmentId: string) {
    const payment = await this.prisma.paymentTransaction.findFirst({
      where: {
        OR: [
          { id: paymentIdOrAppointmentId },
          { invoice: { appointmentId: paymentIdOrAppointmentId } },
          { invoice: { bookingOrderId: paymentIdOrAppointmentId } },
        ],
      },
      include: {
        invoice: {
          include: {
            appointment: true,
            bookingOrder: true,
          },
        },
      },
    });

    if (!payment) throw new NotFoundException('Không tìm thấy giao dịch thanh toán');

    const appointmentId = payment.invoice.appointment?.id || payment.invoice.bookingOrder?.id;

    if (this.bookingService) {
      await this.bookingService.handlePaymentWebhook('PAYOS_SIMULATE', {
        paymentId: payment.id,
        providerTransactionId: payment.providerTransactionId || `sim-${Date.now()}`,
        status: 'SUCCESS',
        payload: { mock: true, paymentId: payment.id },
      });
    }

    return {
      success: true,
      appointmentId,
      bookingOrderId: payment.invoice.bookingOrderId,
      paymentId: payment.id,
      message: 'Mô phỏng thanh toán thành công',
    };
  }

  /**
   * Đồng bộ trực tiếp trạng thái thanh toán từ cổng PayOS Gateway
   */
  async syncPayosPaymentStatus(orderCodeOrAppointmentId: string | number): Promise<any> {
    const payos = this.getPayOSInstance();
    let orderCode: number | null = null;

    if (typeof orderCodeOrAppointmentId === 'number' || /^\d+$/.test(String(orderCodeOrAppointmentId))) {
      orderCode = Number(orderCodeOrAppointmentId);
    } else {
      const payment = await this.prisma.paymentTransaction.findFirst({
        where: {
          OR: [
            { invoice: { appointment: { id: String(orderCodeOrAppointmentId) } } },
            { invoice: { bookingOrder: { id: String(orderCodeOrAppointmentId) } } },
            { id: String(orderCodeOrAppointmentId) },
            { providerTransactionId: String(orderCodeOrAppointmentId) },
          ],
        },
        orderBy: { createdAt: 'desc' },
      });
      if (payment?.providerTransactionId && /^\d+$/.test(payment.providerTransactionId)) {
        orderCode = Number(payment.providerTransactionId);
      }
    }

    if (!orderCode || isNaN(orderCode)) {
      this.logger.warn(`Không xác định được orderCode từ: ${orderCodeOrAppointmentId}`);
      return null;
    }

    try {
      this.logger.log(`[PayOS Sync] Đang truy vấn trạng thái từ PayOS Gateway cho orderCode: ${orderCode}`);
      const paymentInfo: any = typeof (payos as any).getPaymentLinkInformation === 'function'
        ? await (payos as any).getPaymentLinkInformation(orderCode)
        : await payos.paymentRequests.get(orderCode);

      this.logger.log(`[PayOS Sync] Kết quả trạng thái PayOS [${paymentInfo.status}] cho orderCode ${orderCode}`);

      if (paymentInfo.status === 'PAID') {
        const reference = paymentInfo.transactions?.[0]?.reference || `PAYOS-${orderCode}`;
        await this.handleSuccessfulPayment(orderCode, reference, paymentInfo);
        return {
          success: true,
          status: 'PAID',
          orderCode,
          paymentInfo,
        };
      }

      return {
        success: true,
        status: paymentInfo.status,
        orderCode,
        paymentInfo,
      };
    } catch (err: any) {
      this.logger.error(`[PayOS Sync] Lỗi khi gọi getPaymentLinkInformation: ${err.message}`);
      return null;
    }
  }
}


