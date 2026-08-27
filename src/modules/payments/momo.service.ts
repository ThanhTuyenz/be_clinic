import {
  BadGatewayException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { BookingService } from '../appointments/booking.service.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { MomoIpnDto } from './dtos/momo-ipn.dto.js';
import { MomoPaymentMethod } from './dtos/create-momo-payment.dto.js';

type MomoCreateResponse = {
  partnerCode: string;
  requestId: string;
  orderId: string;
  amount: number;
  responseTime: number;
  message: string;
  resultCode: number;
  payUrl?: string;
  deeplink?: string;
  qrCodeUrl?: string;
};

@Injectable()
export class MomoService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly bookingService: BookingService,
  ) {}

  async simulateSuccess(accountId: string, paymentId: string) {
    const payment = await this.prisma.paymentTransaction.findFirst({
      where: {
        id: paymentId,
        OR: [
          { invoice: { appointment: { patientProfile: { accountId } } } },
          { invoice: { bookingOrder: { accountId } } },
        ],
      },
      include: {
        invoice: {
          include: {
            appointment: true,
            bookingOrder: { include: { appointments: true } },
          },
        },
      },
    });
    if (!payment) throw new NotFoundException('Không tìm thấy giao dịch thanh toán');
    const appointmentId = payment.invoice.appointment?.id || payment.invoice.bookingOrder?.appointments?.[0]?.id;

    await this.bookingService.handlePaymentWebhook('MOMO_SANDBOX', {
      paymentId: payment.id,
      providerTransactionId: `DEMO_${Date.now()}`,
      status: 'SUCCESS',
      payload: { mock: true, orderId: payment.id, resultCode: 0 },
    });

    return {
      success: true,
      appointmentId,
      bookingOrderId: payment.invoice.bookingOrderId,
      paymentId: payment.id,
      message: 'Thanh toán mô phỏng thành công!',
    };
  }

  async createPayment(accountId: string, paymentId: string, paymentMethod: MomoPaymentMethod) {
    const settings = this.settings();
    const payment = await this.prisma.paymentTransaction.findFirst({
      where: {
        id: paymentId,
        OR: [
          { invoice: { appointment: { patientProfile: { accountId } } } },
          { invoice: { bookingOrder: { accountId } } },
        ],
      },
      include: {
        invoice: {
          include: {
            appointment: true,
            bookingOrder: { include: { appointments: true } },
          },
        },
      },
    });
    if (!payment) throw new NotFoundException('Không tìm thấy giao dịch thanh toán');
    if (payment.status !== 'PENDING') {
      throw new ConflictException('Giao dịch không còn ở trạng thái chờ thanh toán');
    }

    const appointment = payment.invoice.appointment;
    const bookingOrder = payment.invoice.bookingOrder;
    const firstAppointment = appointment || bookingOrder?.appointments?.[0];

    if (!firstAppointment) {
      throw new NotFoundException('Không tìm thấy lịch hẹn liên kết');
    }

    const holdExpiresAt = firstAppointment.holdExpiresAt;
    if (
      (appointment && appointment.status !== 'PENDING_PAYMENT') ||
      (bookingOrder && (bookingOrder as any).status !== 'PENDING_PAYMENT') ||
      !holdExpiresAt ||
      holdExpiresAt <= new Date()
    ) {
      throw new ConflictException('Thời gian giữ lịch đã hết');
    }

    const amount = Number(payment.amount);
    if (!Number.isSafeInteger(amount) || amount < 1_000 || amount > 50_000_000) {
      throw new ConflictException('Số tiền không nằm trong giới hạn thanh toán MoMo');
    }

    const orderId = payment.id;
    const requestId = payment.id;
    const orderInfo = bookingOrder
      ? `Thanh toan don dat lich ${bookingOrder.orderCode}`
      : `Thanh toan lich kham ${appointment!.id.slice(0, 8)}`;
    const redirectUrl = new URL(settings.redirectUrl);
    if (bookingOrder) {
      redirectUrl.searchParams.set('bookingOrderId', bookingOrder.id);
    } else {
      redirectUrl.searchParams.set('appointmentId', appointment!.id);
    }
    const extraData = Buffer.from(JSON.stringify({
      paymentId: payment.id,
      appointmentId: appointment?.id,
      bookingOrderId: bookingOrder?.id,
    })).toString('base64');
    // Luồng Merchant Gateway chuẩn cho Website (All-In-One: QR Ví MoMo, Thẻ ATM Napas, Thẻ Quốc tế)
    const requestType = 'captureWallet';
    const rawSignature = [
      `accessKey=${settings.accessKey}`,
      `amount=${amount}`,
      `extraData=${extraData}`,
      `ipnUrl=${settings.ipnUrl}`,
      `orderId=${orderId}`,
      `orderInfo=${orderInfo}`,
      `partnerCode=${settings.partnerCode}`,
      `redirectUrl=${redirectUrl.toString()}`,
      `requestId=${requestId}`,
      `requestType=${requestType}`,
    ].join('&');
    const signature = this.sign(rawSignature, settings.secretKey);
    const requestBody = {
      partnerCode: settings.partnerCode,
      requestId,
      amount,
      orderId,
      orderInfo,
      redirectUrl: redirectUrl.toString(),
      ipnUrl: settings.ipnUrl,
      requestType,
      extraData,
      lang: 'vi',
      autoCapture: true,
      signature,
    };

    let momoResponse: MomoCreateResponse;
    try {
      const response = await fetch(settings.createEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(30_000),
      });
      const body = await response.json() as MomoCreateResponse;
      if (!response.ok) {
        throw new BadGatewayException(body.message || 'MoMo không phản hồi thành công');
      }
      momoResponse = body;
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      throw new BadGatewayException('Không thể kết nối cổng thanh toán MoMo');
    }

    await this.prisma.paymentTransaction.update({
      where: { id: payment.id },
      data: {
        provider: 'MOMO_SANDBOX',
        rawPayload: {
          createRequest: { ...requestBody, signature: undefined },
          createResponse: momoResponse,
        } as Prisma.InputJsonValue,
      },
    });

    if (momoResponse.resultCode !== 0 || !momoResponse.payUrl) {
      throw new BadGatewayException(momoResponse.message || 'MoMo không tạo được giao dịch');
    }
    return {
      paymentId: payment.id,
      appointmentId: appointment?.id,
      bookingOrderId: bookingOrder?.id,
      paymentMethod,
      payUrl: momoResponse.payUrl,
      deeplink: momoResponse.deeplink,
      qrCodeUrl: momoResponse.qrCodeUrl,
      holdExpiresAt,
    };
  }

  async handleIpn(dto: MomoIpnDto): Promise<void> {
    const settings = this.settings();
    if (dto.partnerCode !== settings.partnerCode) {
      throw new UnauthorizedException('MoMo partnerCode không hợp lệ');
    }
    const rawSignature = [
      `accessKey=${settings.accessKey}`,
      `amount=${dto.amount}`,
      `extraData=${dto.extraData}`,
      `message=${dto.message}`,
      `orderId=${dto.orderId}`,
      `orderInfo=${dto.orderInfo}`,
      `orderType=${dto.orderType}`,
      `partnerCode=${dto.partnerCode}`,
      `payType=${dto.payType}`,
      `requestId=${dto.requestId}`,
      `responseTime=${dto.responseTime}`,
      `resultCode=${dto.resultCode}`,
      `transId=${dto.transId}`,
    ].join('&');
    this.verifySignature(rawSignature, dto.signature, settings.secretKey);

    const payment = await this.prisma.paymentTransaction.findUnique({
      where: { id: dto.orderId },
    });
    if (!payment || payment.provider !== 'MOMO_SANDBOX') {
      throw new NotFoundException('Không tìm thấy giao dịch MoMo');
    }
    if (Number(payment.amount) !== Number(dto.amount)) {
      throw new UnauthorizedException('Số tiền MoMo không khớp giao dịch');
    }

    await this.bookingService.handlePaymentWebhook('MOMO_SANDBOX', {
      paymentId: payment.id,
      providerTransactionId: String(dto.transId),
      status: dto.resultCode === 0 ? 'SUCCESS' : 'FAILED',
      payload: { ...dto },
    });
  }

  private sign(value: string, secretKey: string): string {
    return createHmac('sha256', secretKey).update(value).digest('hex');
  }

  private verifySignature(value: string, supplied: string, secretKey: string) {
    const expected = Buffer.from(this.sign(value, secretKey), 'utf8');
    const actual = Buffer.from(supplied || '', 'utf8');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new UnauthorizedException('Chữ ký MoMo không hợp lệ');
    }
  }

  private settings() {
    const partnerCode = this.config.get<string>('MOMO_PARTNER_CODE');
    const accessKey = this.config.get<string>('MOMO_ACCESS_KEY');
    const secretKey = this.config.get<string>('MOMO_SECRET_KEY');
    const redirectUrl = this.config.get<string>('MOMO_REDIRECT_URL');
    const ipnUrl = this.config.get<string>('MOMO_IPN_URL');
    const createEndpoint = this.config.get<string>('MOMO_CREATE_ENDPOINT') ||
      'https://test-payment.momo.vn/v2/gateway/api/create';
    if (!partnerCode || !accessKey || !secretKey || !redirectUrl || !ipnUrl) {
      throw new ServiceUnavailableException('MoMo Sandbox chưa được cấu hình đầy đủ');
    }
    return { partnerCode, accessKey, secretKey, redirectUrl, ipnUrl, createEndpoint };
  }
}
