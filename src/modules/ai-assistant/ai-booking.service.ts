import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import QRCode from 'qrcode';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { BookingService } from '../bookings/booking.service.js';
import { BookingFlowService } from '../bookings/booking-flow.service.js';
import { PaymentService } from '../payments/payment.service.js';
import { AiAgentBookingProposal, AiAgentChatResponse } from './dtos/ai-chat.dto.js';
import { ConfirmAiBookingDto, PrepareAiBookingDto } from './dtos/ai-booking.dto.js';

type Quote = {
  kind: 'AI_BOOKING_QUOTE'; proposal: AiAgentBookingProposal; patientProfileId: string;
  patientName: string; voucherCode?: string; subtotal: number; serviceFee: number;
  discountAmount: number; totalAmount: number; expiresAt: string;
};
const asJson = (data: unknown) => JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue;

@Injectable()
export class AiBookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingService,
    private readonly flow: BookingFlowService,
    private readonly payments: PaymentService,
  ) {}

  private async lockSession(tx: Prisma.TransactionClient, sessionId: string, userId: string) {
    await tx.$queryRaw`SELECT id FROM ai_conversations WHERE id = ${sessionId}::uuid FOR UPDATE`;
    const session = await tx.aIConversation.findUnique({ where: { id: sessionId }, select: { userId: true, isClosed: true } });
    if (!session) throw new NotFoundException('Không tìm thấy cuộc trò chuyện.');
    if (session.userId && session.userId !== userId) throw new ForbiddenException('Bạn không có quyền truy cập cuộc trò chuyện này.');
    if (!session.userId) await tx.aIConversation.update({ where: { id: sessionId }, data: { userId } });
    return session;
  }

  private async proposal(tx: Prisma.TransactionClient, sessionId: string, proposalId: string) {
    const message = await tx.aIMessage.findFirst({
      where: { conversationId: sessionId, sender: 'ASSISTANT' }, orderBy: { createdAt: 'desc' },
      select: { structuredResponse: true },
    });
    const proposal = (message?.structuredResponse as unknown as AiAgentChatResponse | null)?.proposal;
    if (!proposal || proposal.id !== proposalId || Date.parse(proposal.expiresAt) <= Date.now()) {
      throw new ConflictException('Đề xuất đã thay đổi hoặc hết hạn. Vui lòng tìm lại lịch.');
    }
    return proposal;
  }

  private async pricing(tx: Prisma.TransactionClient, userId: string, proposal: AiAgentBookingProposal, voucherCode?: string) {
    const slot = await tx.doctorScheduleSlot.findUnique({
      where: { id: proposal.slotId }, select: {
        isActive: true, slotStatus: true, occupiedCount: true, capacity: true, startTime: true, endTime: true,
        schedule: { select: { status: true, workDate: true, doctorId: true, branchId: true, doctor: {
          select: { consultationFee: true, onlineConsultationFee: true },
        } } },
      },
    });
    if (!slot?.isActive || slot.slotStatus !== 'AVAILABLE' || slot.schedule.status !== 'OPEN'
      || slot.occupiedCount >= slot.capacity || slot.schedule.doctorId !== proposal.doctorId || slot.schedule.branchId !== proposal.branchId) {
      throw new ConflictException('Lịch khám không còn khả dụng. Vui lòng tìm lại lịch.');
    }
    if (slot.schedule.workDate.toISOString().slice(0, 10) !== proposal.date
      || slot.startTime.toISOString().slice(11, 16) !== proposal.startTime || slot.endTime.toISOString().slice(11, 16) !== proposal.endTime) {
      throw new ConflictException('Ngày giờ khám đã thay đổi. Vui lòng tìm lại lịch.');
    }
    const pkg = proposal.servicePackageId ? await tx.servicePackage.findUnique({
      where: { id: proposal.servicePackageId }, select: { price: true, isActive: true },
    }) : null;
    if (proposal.servicePackageId && !pkg?.isActive) throw new BadRequestException('Dịch vụ không còn khả dụng.');
    const doctor = slot.schedule.doctor;
    const fee = pkg?.price ?? (proposal.bookingMethodCode === 'ONLINE_CONSULTATION'
      ? doctor.onlineConsultationFee ?? doctor.consultationFee : doctor.consultationFee);
    const { voucherApplied: _, ...pricing } = await this.bookings.calculateCheckoutTotals(tx, userId, Number(fee), voucherCode);
    return pricing;
  }

  async prepare(userId: string, dto: PrepareAiBookingDto) {
    return this.prisma.$transaction(async tx => {
      const session = await this.lockSession(tx, dto.sessionId, userId);
      if (session.isClosed) throw new ConflictException('Phiên này đã tạo lịch. Vui lòng tiếp tục thanh toán hoặc mở phiên mới.');
      const proposal = await this.proposal(tx, dto.sessionId, dto.proposalId);
      const profile = await tx.patientProfile.findFirst({
        where: { id: dto.patientProfileId, accountId: userId }, select: { fullName: true },
      });
      if (!profile) throw new NotFoundException('Không tìm thấy hồ sơ người bệnh của bạn.');
      // Apply the same booking date policy before displaying the final confirmation.
      this.flow.getBookingDateRange().resolveDate(proposal.date);
      const pricing = await this.pricing(tx, userId, proposal, dto.voucherCode);
      const quote: Quote = {
        kind: 'AI_BOOKING_QUOTE', proposal, patientProfileId: dto.patientProfileId, patientName: profile.fullName,
        voucherCode: dto.voucherCode, ...pricing,
        expiresAt: new Date(Math.min(Date.parse(proposal.expiresAt), Date.now() + 5 * 60_000)).toISOString(),
      };
      const row = await tx.aIMessage.create({ data: {
        conversationId: dto.sessionId, sender: 'SYSTEM', content: 'Xác nhận thông tin đặt lịch', structuredResponse: asJson(quote),
      }, select: { id: true } });
      return { quoteId: row.id, ...quote };
    });
  }

  async confirm(userId: string, dto: ConfirmAiBookingDto) {
    try {
      return await this.prisma.$transaction(async tx => {
        const session = await this.lockSession(tx, dto.sessionId, userId);
        const previous = await tx.aIBookingIntentLog.findFirst({
          where: { conversationId: dto.sessionId, userId, detectedIntent: 'CHAT_CHECKOUT', isSuccessful: true },
          select: { extractedParams: true },
        });
        // The receipt is committed atomically with the hold. Retries never reserve another slot.
        if (previous) {
          if ((previous.extractedParams as { quoteId?: string })?.quoteId !== dto.quoteId) {
            throw new ConflictException('Phiên này đã xác nhận một lựa chọn khác. Vui lòng kiểm tra lịch đã tạo.');
          }
          return previous.extractedParams;
        }
        if (session.isClosed) throw new ConflictException('Phiên đã đóng. Vui lòng mở cuộc trò chuyện mới.');
        const row = await tx.aIMessage.findFirst({
          where: { id: dto.quoteId, conversationId: dto.sessionId, sender: 'SYSTEM' }, select: { structuredResponse: true },
        });
        const quote = row?.structuredResponse as unknown as Quote | null;
        if (quote?.kind !== 'AI_BOOKING_QUOTE' || Date.parse(quote.expiresAt) <= Date.now()) {
          throw new ConflictException('Thông tin xác nhận đã hết hạn. Vui lòng kiểm tra lại.');
        }
        const proposal = await this.proposal(tx, dto.sessionId, quote.proposal.id);
        if (dto.bookingMethodCode !== proposal.bookingMethodCode) throw new BadRequestException('Vui lòng xác nhận đúng hình thức khám.');
        const pricing = await this.pricing(tx, userId, proposal, quote.voucherCode);
        if (pricing.totalAmount !== quote.totalAmount || pricing.subtotal !== quote.subtotal || pricing.discountAmount !== quote.discountAmount) {
          throw new ConflictException('Chi phí đã thay đổi. Vui lòng kiểm tra lại trước khi xác nhận.');
        }
        const booking = await this.bookings.checkout(userId, {
          patientProfileId: quote.patientProfileId, bookingMethodCode: proposal.bookingMethodCode,
          scheduleSlotId: proposal.slotId, servicePackageId: proposal.servicePackageId,
          voucherCode: quote.voucherCode, bookedViaAi: true,
        }, tx);
        const receipt = { ...booking, quoteId: dto.quoteId, proposal, patientName: quote.patientName };
        await tx.aIBookingIntentLog.create({ data: {
          conversationId: dto.sessionId, userId, detectedIntent: 'CHAT_CHECKOUT', isSuccessful: true,
          appointmentId: booking.appointmentId, extractedParams: asJson(receipt),
        } });
        await tx.aIConversation.update({ where: { id: dto.sessionId }, data: { isClosed: true } });
        return asJson(receipt);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        throw new ConflictException('Thông tin vừa được cập nhật. Vui lòng thử lại; lịch đã tạo sẽ được sử dụng lại.');
      }
      throw error;
    }
  }

  async state(userId: string, sessionId: string) {
    const session = await this.prisma.aIConversation.findFirst({ where: { id: sessionId, OR: [{ userId }, { userId: null }] }, select: { id: true } });
    if (!session) throw new NotFoundException('Không tìm thấy cuộc trò chuyện của bạn.');
    const intent = await this.prisma.aIBookingIntentLog.findFirst({
      where: { conversationId: sessionId, userId, detectedIntent: 'CHAT_CHECKOUT', isSuccessful: true },
      select: { appointmentId: true, extractedParams: true },
    });
    if (!intent?.appointmentId) return null;
    return { booking: intent.extractedParams, status: await this.payments.paymentStatus(intent.appointmentId, userId) };
  }

  async createPayment(userId: string, sessionId: string) {
    const state = await this.state(userId, sessionId);
    if (!state) throw new NotFoundException('Chưa có lịch giữ chỗ trong phiên này.');
    const booking = state.booking as { appointmentId: string; totalAmount: number };
    const link = await this.payments.createPaymentUrl(booking.appointmentId, booking.totalAmount, undefined, userId);
    const qrImageDataUrl: string = await QRCode.toDataURL(link.qrCode, { width: 280, margin: 2 });
    return { ...link, qrImageDataUrl, demo: link.amount !== booking.totalAmount };
  }

  async cancel(userId: string, sessionId: string) {
    const state = await this.state(userId, sessionId);
    if (!state) throw new NotFoundException('Chưa có lịch giữ chỗ trong phiên này.');
    const booking = state.booking as { paymentId: string };
    await this.bookings.cancelUnpaidPayment(booking.paymentId, userId);
    return this.state(userId, sessionId);
  }
}
