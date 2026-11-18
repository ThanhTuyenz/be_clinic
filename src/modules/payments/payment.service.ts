import {
BadRequestException,
ConflictException,
Injectable,
InternalServerErrorException,
Logger,
NotFoundException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PayOS } from '@payos/node';
import { createHash } from 'node:crypto';
import { isUuid } from '../../common/utils/staff.utils.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { BookingService } from '../bookings/booking.service.js';
import { PaymentLinkResponse } from './dtos/payment.dto.js';
import { PaymentSettlementService } from './payment-settlement.service.js';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private payOS: PayOS | null = null;
  private readonly returnUrl: string;
  private readonly cancelUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly bookingService: BookingService,
    private readonly settlement: PaymentSettlementService,
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
   * Helper: Lấy instance PayOS đã khởi tạo, hoặc khởi tạo mới nếu chưa có
   */
  private getPayOSInstance(): PayOS {
    if (this.payOS) return this.payOS;

    const clientId = (this.configService.get<string>('PAYOS_CLIENT_ID') || '').trim();
    const apiKey = (this.configService.get<string>('PAYOS_API_KEY') || '').trim();
    const checksumKey = (this.configService.get<string>('PAYOS_CHECKSUM_KEY') || '').trim();

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
    accountId?: string,
  ): Promise<PaymentLinkResponse> {
    if (!isUuid(appointmentId)) throw new BadRequestException('Mã lịch hẹn không hợp lệ.');
    const invoice = await this.prisma.invoice.findFirst({
      where: {
        OR: [{ bookingOrder: { appointments: { some: { id: appointmentId } } } }, { payments: { some: { id: appointmentId } } }, { bookingOrderId: appointmentId }],
        ...(accountId ? { bookingOrder: { accountId } } : {}),
      }, select: { id: true },
    });
    if (!invoice) throw new NotFoundException('Không tìm thấy hóa đơn của bạn.');
    // Serialize gateway creation across processes without holding invoice row locks during network I/O.
    return this.prisma.$transaction(async lock => {
      await lock.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${invoice.id}, 0))`;
      return this.createPaymentUrlLocked(appointmentId, amount, customDescription, accountId);
    }, { maxWait: 5000, timeout: 45_000 });
  }

  private async createPaymentUrlLocked(appointmentId: string, amount: number, customDescription?: string, accountId?: string): Promise<PaymentLinkResponse> {
    const payos = this.getPayOSInstance();

    const invoice = await this.prisma.invoice.findFirst({
      where: {
        OR: [
          { bookingOrder: { appointments: { some: { id: appointmentId } } } },
          { payments: { some: { id: appointmentId } } },
          { bookingOrderId: appointmentId },
        ],
        ...(accountId ? { bookingOrder: { accountId } } : {}),
      },
      include: {
        payments: true,
        bookingOrder: { include: { appointments: { orderBy: { createdAt: 'asc' }, select: { id: true, status: true, holdExpiresAt: true } } } },
      },
    });
    const appointment = invoice?.bookingOrder.appointments.find(item => item.id === appointmentId) ?? invoice?.bookingOrder.appointments[0];
    const targetAppointmentId = appointment?.id;

    if (!invoice || !targetAppointmentId) {
      throw new NotFoundException(`Không tìm thấy lịch hẹn hoặc giao dịch với ID: ${appointmentId}`);
    }
    if (invoice.status !== 'UNPAID' || invoice.bookingOrder.appointments.some(item => item.status !== 'HOLD') || invoice.payments.every((payment) => payment.status !== 'PENDING')) {
      throw new BadRequestException('Lịch hẹn không còn ở trạng thái chờ thanh toán');
    }

    const holdExpiresAt = invoice.bookingOrder.appointments.reduce<Date | null>((earliest, item) =>
      item.holdExpiresAt && (!earliest || item.holdExpiresAt < earliest) ? item.holdExpiresAt : earliest, null);
    if (!holdExpiresAt) {
      throw new BadRequestException('Lịch hẹn không còn thời gian giữ chỗ. Vui lòng đặt lịch lại.');
    }
    const expiredAt = Math.floor(holdExpiresAt.getTime() / 1000);
    if (expiredAt <= Math.floor(Date.now() / 1000)) {
      throw new BadRequestException('Đã hết thời gian giữ chỗ. Vui lòng đặt lịch lại.');
    }

    const pendingLink = invoice.payments.find(payment => payment.status === 'PENDING' && payment.provider === 'PAYOS');
    const savedLink = pendingLink?.rawPayload as Record<string, unknown> | null;
    if (pendingLink?.providerTransactionId && typeof savedLink?.checkoutUrl === 'string') {
      return {
        orderCode: Number(pendingLink.providerTransactionId), amount: Number(pendingLink.amount),
        description: typeof savedLink.description === 'string' ? savedLink.description : '',
        checkoutUrl: savedLink.checkoutUrl,
        qrCode: typeof savedLink.qrCode === 'string' ? savedLink.qrCode : '',
        paymentLinkId: typeof savedLink.paymentLinkId === 'string' ? savedLink.paymentLinkId : '',
        accountNumber: typeof savedLink.accountNumber === 'string' ? savedLink.accountNumber : '',
        accountName: typeof savedLink.accountName === 'string' ? savedLink.accountName : '',
        bin: typeof savedLink.bin === 'string' ? savedLink.bin : '',
        holdExpiresAt: holdExpiresAt.toISOString(),
      };
    }

    // A stable code lets retries recover a link even if the gateway succeeded before a timeout.
    let orderCode = pendingLink?.providerTransactionId ? Number(pendingLink.providerTransactionId)
      : Number.parseInt(createHash('sha256').update(invoice.id).digest('hex').slice(0, 12), 16);
    const description = this.sanitizeDescription(
      customDescription || `KHAM ${orderCode}`,
      orderCode,
    );

    // CHẾ ĐỘ AN TOÀN DEMO/TEST: Ép số tiền thanh toán sang PayOS luôn là 1.000 VNĐ
    // để bạn có thể quét bằng App ngân hàng thật mà không lo bị trừ số tiền lớn.
    const configuredDemoAmount = this.configService.get<string>('PAYOS_TEST_AMOUNT');
    const invoiceAmount = Number(invoice.totalAmount);
    const payAmount = configuredDemoAmount === '0' ? invoiceAmount : Number(configuredDemoAmount || 1000);
    if (!Number.isSafeInteger(payAmount) || payAmount < 1000) throw new BadRequestException('Số tiền PayOS không hợp lệ.');
    if (configuredDemoAmount !== '0') this.logger.warn(
      `[AN TOÀN DEMO] Số tiền gốc ${amount.toLocaleString('vi-VN')} VNĐ được ghi đè thành ${payAmount.toLocaleString('vi-VN')} VNĐ trên link thanh toán PayOS.`,
    );

    const paymentLinkData = {
      orderCode,
      amount: payAmount,
      description,
      returnUrl: `${this.returnUrl}?appointmentId=${targetAppointmentId}&orderCode=${orderCode}`,
      cancelUrl: `${this.cancelUrl}?appointmentId=${targetAppointmentId}&orderCode=${orderCode}`,
      expiredAt,
    };

    try {
      this.logger.log(
        `Đang tạo link PayOS cho Appointment [${targetAppointmentId}] - OrderCode: ${orderCode} - Số tiền: ${payAmount} VNĐ`,
      );

      let pendingPayment = invoice.payments.find(payment => payment.status === 'PENDING');
      if (!pendingPayment) throw new BadRequestException('Không có giao dịch chờ thanh toán.');
      const reserved = await this.prisma.paymentTransaction.updateMany({
        where: { id: pendingPayment.id, status: 'PENDING' },
        data: { provider: 'PAYOS', providerTransactionId: String(orderCode), method: 'VIETQR', amount: payAmount },
      });
      if (!reserved.count) throw new ConflictException('Giao dịch đã thay đổi. Vui lòng kiểm tra lại trạng thái.');
      // Persist the gateway identity first so an early webhook can find the payment.
      let paymentLink: any;
      try {
        paymentLink = typeof (payos as any).createPaymentLink === 'function'
          ? await (payos as any).createPaymentLink(paymentLinkData)
          : await payos.paymentRequests.create(paymentLinkData, { timeout: 10_000, maxRetries: 0 });
      } catch (createError) {
        let recovered: any;
        try {
          recovered = typeof (payos as any).getPaymentLinkInformation === 'function'
            ? await (payos as any).getPaymentLinkInformation(orderCode)
            : await payos.paymentRequests.get(orderCode, { timeout: 5000, maxRetries: 0 });
        } catch { throw createError; }
        if (recovered.status === 'PAID') {
          await this.syncPayosPaymentStatus(orderCode, accountId);
          throw new ConflictException('Giao dịch đã thanh toán. Vui lòng kiểm tra lại trạng thái.');
        }
        if (!['PENDING', 'CANCELLED', 'EXPIRED'].includes(recovered.status)) throw createError;
        if (expiredAt <= Math.floor(Date.now() / 1000)) throw new BadRequestException('Đã hết thời gian giữ chỗ. Vui lòng đặt lịch lại.');
        // GET does not return QR data. Retire an orphaned link before replacing it.
        if (recovered.status === 'PENDING') {
          const cancelled = typeof (payos as any).cancelPaymentLink === 'function'
            ? await (payos as any).cancelPaymentLink(orderCode, 'Khoi phuc ma thanh toan')
            : await payos.paymentRequests.cancel(orderCode, 'Khoi phuc ma thanh toan', { timeout: 5000, maxRetries: 0 });
          if (cancelled.status !== 'CANCELLED') throw new ConflictException('Giao dịch đang được xử lý. Vui lòng kiểm tra lại trạng thái.');
        }
        orderCode = this.generateOrderCode();
        const previousId = pendingPayment.id;
        pendingPayment = await this.prisma.$transaction(async tx => {
          const previous = await tx.paymentTransaction.updateMany({
            where: { id: previousId, status: 'PENDING', invoice: { status: 'UNPAID' } }, data: { status: 'CANCELLED' },
          });
          if (!previous.count) throw new ConflictException('Giao dịch đã thay đổi. Vui lòng kiểm tra lại trạng thái.');
          // Keep old gateway references so late webhooks remain traceable.
          return tx.paymentTransaction.create({ data: {
            invoiceId: invoice.id, provider: 'PAYOS', providerTransactionId: String(orderCode),
            idempotencyKey: `payos:${invoice.id}:${orderCode}`, method: 'VIETQR', amount: payAmount,
          } });
        });
        paymentLinkData.orderCode = orderCode;
        paymentLink = typeof (payos as any).createPaymentLink === 'function'
          ? await (payos as any).createPaymentLink(paymentLinkData)
          : await payos.paymentRequests.create(paymentLinkData, { timeout: 10_000, maxRetries: 0 });
      }

      // Never overwrite settlement evidence if a webhook has already completed the payment.
      const saved = await this.prisma.paymentTransaction.updateMany({
        where: { id: pendingPayment.id, status: 'PENDING' },
        data: { rawPayload: {
          orderCode, paymentLinkId: paymentLink.paymentLinkId,
          checkoutUrl: paymentLink.checkoutUrl, qrCode: paymentLink.qrCode,
          description, accountNumber: paymentLink.accountNumber || '',
          accountName: paymentLink.accountName || '', bin: paymentLink.bin || '',
        } },
      });
      if (!saved.count) throw new ConflictException('Giao dịch đã cập nhật. Vui lòng kiểm tra lại trạng thái.');

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
        holdExpiresAt: holdExpiresAt.toISOString(),
      };
    } catch (error: any) {
      if (error instanceof ConflictException || error instanceof BadRequestException) throw error;
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
        return await (payos as any).verifyPaymentWebhookData(webhookBody);
      }
      if (payos.webhooks && typeof payos.webhooks.verify === 'function') {
        return await payos.webhooks.verify(webhookBody);
      }
      throw new Error('PayOS SDK không hỗ trợ xác thực webhook');
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

    const receivedAmount = Number(rawPayload?.data?.amount ?? rawPayload?.amount ?? 0);
    if (!receivedAmount || receivedAmount !== Number(payment.amount)) {
      throw new BadRequestException('Số tiền webhook không khớp giao dịch đang chờ');
    }

    await this.settlement.handlePaymentWebhook('PAYOS', {
      paymentId: payment.id, providerTransactionId: String(orderCode), status: 'SUCCESS',
      payload: { orderCode, reference, raw: rawPayload },
    });
  }

  /**
   * Mô phỏng thanh toán thành công (Dành cho Test / Demo khi không quét mã QR)
   */
  async simulateSuccess(accountId: string, paymentIdOrAppointmentId: string) {
    const payment = await this.prisma.paymentTransaction.findFirst({
      where: {
        OR: [
          { id: paymentIdOrAppointmentId },
          { invoice: { bookingOrder: { appointments: { some: { id: paymentIdOrAppointmentId } } } } },
          { invoice: { bookingOrderId: paymentIdOrAppointmentId } },
        ],
        invoice: {
          bookingOrder: { accountId },
        },
      },
      include: {
        invoice: {
          include: {
            bookingOrder: { include: { appointments: { select: { id: true }, orderBy: { createdAt: 'asc' }, take: 1 } } },
          },
        },
      },
    });

    if (!payment) throw new NotFoundException('Không tìm thấy giao dịch thanh toán');

    const appointmentId = payment.invoice.bookingOrder.appointments[0]?.id;

    await this.settlement.handlePaymentWebhook('PAYOS_SIMULATE', {
        paymentId: payment.id,
        providerTransactionId: payment.providerTransactionId || `sim-${Date.now()}`,
        status: 'SUCCESS',
        payload: { mock: true, paymentId: payment.id },
      });

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
  async syncPayosPaymentStatus(orderCodeOrAppointmentId: string | number, accountId?: string): Promise<any> {
    const payos = this.getPayOSInstance();
    let orderCode: number | null = null;

    if (typeof orderCodeOrAppointmentId === 'number' || /^\d+$/.test(String(orderCodeOrAppointmentId))) {
      orderCode = Number(orderCodeOrAppointmentId);
    } else {
      const payment = await this.prisma.paymentTransaction.findFirst({
        where: {
          OR: [
            { invoice: { bookingOrder: { appointments: { some: { id: String(orderCodeOrAppointmentId) } } } } },
            { invoice: { bookingOrder: { id: String(orderCodeOrAppointmentId) } } },
            { id: String(orderCodeOrAppointmentId) },
            { providerTransactionId: String(orderCodeOrAppointmentId) },
          ],
          ...(accountId
            ? {
                invoice: {
                  bookingOrder: { accountId },
                },
              }
            : {}),
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

    if (accountId) {
      const ownedPayment = await this.prisma.paymentTransaction.findFirst({
        where: { providerTransactionId: String(orderCode), invoice: { bookingOrder: { accountId } } },
        select: { id: true },
      });
      if (!ownedPayment) throw new NotFoundException('Không tìm thấy giao dịch thanh toán');
    }

    try {
      this.logger.log(`[PayOS Sync] Đang truy vấn trạng thái từ PayOS Gateway cho orderCode: ${orderCode}`);
      const paymentInfo: any = typeof (payos as any).getPaymentLinkInformation === 'function'
        ? await (payos as any).getPaymentLinkInformation(orderCode)
        : await payos.paymentRequests.get(orderCode, { timeout: 5000, maxRetries: 0 });

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

      if (paymentInfo.status === 'CANCELLED' && accountId && this.bookingService) {
        await this.bookingService.cancelUnpaidPayment(String(orderCode), accountId);
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

  async paymentStatus(appointmentIdOrOrderId: string, accountId: string) {
    const row = await this.prisma.appointment.findFirst({
      where: {
        id: appointmentIdOrOrderId,
        OR: [
          { patientProfile: { accountId } },
          { bookingOrder: { accountId } },
        ],
      },
      select: {
        id: true,
        bookingOrderId: true,
        status: true,
        holdExpiresAt: true,
        bookingCode: true,
        bookingMethod: { select: { code: true, name: true } },
        telehealthSession: { select: { id: true } },
        queueNumber: true,
        bookingOrder: { select: { invoice: { select: { status: true, payments: { select: { status: true }, orderBy: { createdAt: 'desc' }, take: 1 } } } } },
        qrToken: { select: { id: true } },
        branch: { select: { id: true, name: true, address: true } },
        scheduleSlot: {
          select: {
            schedule: {
              select: {
                room: { select: { id: true, code: true, name: true } },
                branch: { select: { id: true, name: true, address: true } },
              },
            },
          },
        },
      },
    });

    if (!row) {
      // Thử tìm theo bookingOrderId
      const order = await this.prisma.bookingOrder.findFirst({
        where: { id: appointmentIdOrOrderId, accountId },
        select: {
          id: true,
          orderCode: true,
          groupType: true,
          status: true,
          totalAmount: true,
          invoice: { select: { status: true, payments: { select: { status: true }, orderBy: { createdAt: 'desc' }, take: 1 } } },
          appointments: {
            select: {
              id: true,
              bookingCode: true,
              status: true,
              queueNumber: true,
              patientProfile: { select: { id: true, fullName: true } },
              qrToken: { select: { id: true } },
            },
          },
        },
      });
      if (!order) throw new NotFoundException('Không tìm thấy lịch hẹn hoặc đơn đặt lịch');
      const firstAppt = order.appointments[0];
      return {
        bookingOrderId: order.id,
        appointmentId: firstAppt?.id || order.id,
        orderCode: order.orderCode,
        groupType: order.groupType,
        status: order.status,
        paymentStatus: order.invoice?.status === 'PAID' ? 'SUCCESS' : order.invoice?.payments[0]?.status ?? null,
        totalAmount: Number(order.totalAmount),
        appointments: order.appointments.map((a: any) => ({
          appointmentId: a.id,
          bookingCode: a.bookingCode,
          status: a.status,
          queueNumber: a.queueNumber,
          patient: { id: a.patientProfile?.id, fullName: a.patientProfile?.fullName },
          hasQr: Boolean(a.qrToken),
        })),
      };
    }

    const doctorSlot = row.scheduleSlot;
    const isTelehealth = Boolean(row.telehealthSession || row.bookingMethod?.code === 'ONLINE_CONSULTATION');
    const room = doctorSlot?.schedule.room;
    const branch = doctorSlot?.schedule.branch ?? row.branch;
    const estimatedQueueNumber = row.queueNumber;

    let siblingAppts: any[] = [];
    if (row.bookingOrderId) {
      const siblings = await this.prisma.appointment.findMany({
        where: { bookingOrderId: row.bookingOrderId },
        select: {
          id: true,
          bookingCode: true,
          status: true,
          queueNumber: true,
          patientProfile: { select: { id: true, fullName: true } },
          qrToken: { select: { id: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
      siblingAppts = siblings.map((a: any) => ({
        appointmentId: a.id,
        bookingCode: a.bookingCode,
        status: a.status,
        queueNumber: a.queueNumber,
        patient: { id: a.patientProfile?.id, fullName: a.patientProfile?.fullName },
        hasQr: Boolean(a.qrToken),
      }));
    }

    return {
      appointmentId: row.id,
      bookingOrderId: row.bookingOrderId,
      status: row.status,
      holdExpiresAt: row.holdExpiresAt,
      paymentStatus: row.bookingOrder.invoice?.status === 'PAID' ? 'SUCCESS' : row.bookingOrder.invoice?.payments[0]?.status ?? null,
      hasQr: Boolean(row.qrToken),
      bookingCode: row.bookingCode,
      isTelehealth,
      bookingMethod: row.bookingMethod,
      queueNumber: row.queueNumber,
      estimatedQueueNumber: row.queueNumber ?? estimatedQueueNumber,
      room: !isTelehealth && room ? { id: room.id, code: room.code, name: room.name } : null,
      branch: branch ? { id: branch.id, name: branch.name, address: branch.address } : null,
      appointments: siblingAppts.length > 0 ? siblingAppts : undefined,
    };
  }

  // Bộ nhớ cache tạm danh sách ngân hàng
  private banksCache: any[] | null = null;
  private banksCacheExpiresAt = 0;

  /**
   * Lấy danh sách ngân hàng hỗ trợ VietQR (có logo, tên, mã BIN)
   */
  async getBanks(): Promise<any[]> {
    const now = Date.now();
    if (this.banksCache && this.banksCacheExpiresAt > now) {
      return this.banksCache;
    }

    try {
      const res = await fetch('https://api.vietqr.io/v2/banks', { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const json: any = await res.json();
        if (Array.isArray(json?.data) && json.data.length > 0) {
          this.banksCache = json.data;
          this.banksCacheExpiresAt = now + 12 * 60 * 60 * 1000; // cache 12 giờ
          return json.data;
        }
      }
    } catch (err: any) {
      this.logger.warn(`Không lấy được danh sách ngân hàng từ VietQR: ${err.message}, dùng fallback`);
    }

    // Danh sách ngân hàng phổ biến dự phòng nếu không kết nối được VietQR
    const fallbackBanks = [
      { id: 17, name: 'Ngân hàng TMCP Quân đội', code: 'MB', bin: '970422', shortName: 'MBBank', logo: 'https://api.vietqr.io/img/MB.png' },
      { id: 43, name: 'Ngân hàng TMCP Ngoại Thương Việt Nam', code: 'VCB', bin: '970436', shortName: 'Vietcombank', logo: 'https://api.vietqr.io/img/VCB.png' },
      { id: 38, name: 'Ngân hàng TMCP Kỹ thương Việt Nam', code: 'TCB', bin: '970407', shortName: 'Techcombank', logo: 'https://api.vietqr.io/img/TCB.png' },
      { id: 42, name: 'Ngân hàng TMCP Công thương Việt Nam', code: 'CTG', bin: '970415', shortName: 'VietinBank', logo: 'https://api.vietqr.io/img/CTG.png' },
      { id: 4, name: 'Ngân hàng TMCP Đầu tư và Phát triển Việt Nam', code: 'BIDV', bin: '970418', shortName: 'BIDV', logo: 'https://api.vietqr.io/img/BIDV.png' },
      { id: 45, name: 'Ngân hàng TMCP Việt Nam Thịnh Vượng', code: 'VPB', bin: '970432', shortName: 'VPBank', logo: 'https://api.vietqr.io/img/VPB.png' },
      { id: 2, name: 'Ngân hàng TMCP Á Châu', code: 'ACB', bin: '970416', shortName: 'ACB', logo: 'https://api.vietqr.io/img/ACB.png' },
      { id: 41, name: 'Ngân hàng TMCP Tiên Phong', code: 'TPB', bin: '970423', shortName: 'TPBank', logo: 'https://api.vietqr.io/img/TPB.png' },
      { id: 33, name: 'Ngân hàng TMCP Sài Gòn Thương Tín', code: 'STB', bin: '970403', shortName: 'Sacombank', logo: 'https://api.vietqr.io/img/STB.png' },
      { id: 11, name: 'Ngân hàng TMCP Phát triển TP.HCM', code: 'HDB', bin: '970437', shortName: 'HDBank', logo: 'https://api.vietqr.io/img/HDB.png' },
      { id: 44, name: 'Ngân hàng TMCP Quốc tế Việt Nam', code: 'VIB', bin: '970441', shortName: 'VIB', logo: 'https://api.vietqr.io/img/VIB.png' },
      { id: 32, name: 'Ngân hàng TMCP Sài Gòn - Hà Nội', code: 'SHB', bin: '970443', shortName: 'SHB', logo: 'https://api.vietqr.io/img/SHB.png' },
      { id: 1, name: 'Ngân hàng Nông nghiệp và Phát triển Nông thôn Việt Nam', code: 'VBA', bin: '970405', shortName: 'Agribank', logo: 'https://api.vietqr.io/img/VBA.png' },
      { id: 31, name: 'Ngân hàng TMCP Đông Nam Á', code: 'SEAB', bin: '970440', shortName: 'SeABank', logo: 'https://api.vietqr.io/img/SEAB.png' },
      { id: 22, name: 'Ngân hàng TMCP Hàng Hải Việt Nam', code: 'MSB', bin: '970426', shortName: 'MSB', logo: 'https://api.vietqr.io/img/MSB.png' },
      { id: 27, name: 'Ngân hàng TMCP Phương Đông', code: 'OCB', bin: '970448', shortName: 'OCB', logo: 'https://api.vietqr.io/img/OCB.png' },
      { id: 19, name: 'Ngân hàng TMCP Nam Á', code: 'NAB', bin: '970428', shortName: 'NamABank', logo: 'https://api.vietqr.io/img/NAB.png' },
      { id: 24, name: 'Ngân hàng TMCP Quốc dân', code: 'NCB', bin: '970419', shortName: 'NCB', logo: 'https://api.vietqr.io/img/NCB.png' },
      { id: 5, name: 'Ngân hàng TMCP Bảo Việt', code: 'BVB', bin: '970438', shortName: 'BaoVietBank', logo: 'https://api.vietqr.io/img/BVB.png' },
      { id: 18, name: 'Ngân hàng TNHH MTV Shinhan Việt Nam', code: 'SHBVN', bin: '970424', shortName: 'ShinhanBank', logo: 'https://api.vietqr.io/img/SHBVN.png' },
    ];
    return fallbackBanks;
  }

  /**
   * Tra cứu tên chủ tài khoản ngân hàng thụ hưởng qua Napas 247 / VietQR Lookup
   */
  async lookupBankAccount(bin: string, accountNumber: string): Promise<{ success: boolean; accountName?: string; message?: string }> {
    const cleanBin = String(bin || '').trim();
    const cleanAccount = String(accountNumber || '').trim().replace(/[^0-9]/g, '');

    if (!cleanBin) {
      return { success: false, message: 'Vui lòng chọn ngân hàng' };
    }
    if (!cleanAccount || cleanAccount.length < 6 || cleanAccount.length > 20) {
      return { success: false, message: 'Số tài khoản phải gồm từ 6 đến 20 chữ số' };
    }

    const clientId = this.configService.get<string>('VIETQR_CLIENT_ID');
    const apiKey = this.configService.get<string>('VIETQR_API_KEY');

    // 1. Nếu có cấu hình VietQR API key -> Gọi API VietQR chính thức
    if (clientId && apiKey) {
      try {
        const response = await fetch('https://api.vietqr.io/v2/lookup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-client-id': clientId,
            'x-api-key': apiKey,
          },
          body: JSON.stringify({
            bin: cleanBin,
            accountNumber: cleanAccount,
          }),
          signal: AbortSignal.timeout(6000),
        });

        const data: any = await response.json();
        if (data.code === '00' && data.data?.accountName) {
          return {
            success: true,
            accountName: String(data.data.accountName).trim().toUpperCase(),
          };
        }

        return {
          success: false,
          message: data.desc || 'Không tìm thấy thông tin tài khoản hoặc số tài khoản không hợp lệ tại ngân hàng này.',
        };
      } catch (err: any) {
        this.logger.error(`Lỗi khi gọi VietQR lookup: ${err.message}`);
      }
    }

    // 2. Môi trường phát triển / Demo (Khi chưa có VietQR API key):
    // Giả lập tra cứu thành công để demo tính năng không bị chặn
    return {
      success: true,
      accountName: 'NGUYEN VAN A (DEMO TEST)',
      message: 'Tra cứu giả lập thành công (Demo Mode)',
    };
  }
}
