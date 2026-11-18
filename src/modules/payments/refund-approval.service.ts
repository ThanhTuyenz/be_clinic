import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { getStaffUser } from '../../common/utils/staff.utils.js';
import { appointmentTransaction } from '../appointments/helpers/appointment-mutation.helper.js';
import { getAppointmentRefundQuote } from './appointment-refund.js';
import { ApproveRefundDto } from './dtos/approve-refund.dto.js';

@Injectable()
export class RefundApprovalService {
  constructor(private readonly prisma: PrismaService) {}

  async approve(userId: string, appointmentId: string, input: ApproveRefundDto) {
    const actor = await getStaffUser(this.prisma, userId);
    if (actor.role !== 'BRANCH_MANAGER' || !actor.branchId) {
      throw new ForbiddenException('Chỉ quản lý chi nhánh được duyệt khoản hoàn tiền');
    }
    return appointmentTransaction(this.prisma, async tx => {
      const appointment = await tx.appointment.findUnique({
        where: { id: appointmentId }, select: { id: true, branchId: true, status: true, bookingOrderId: true },
      });
      if (!appointment) throw new NotFoundException('Không tìm thấy lịch hẹn');
      if (appointment.branchId !== actor.branchId) throw new ForbiddenException('Chỉ được duyệt hoàn tiền tại chi nhánh phụ trách');
      if (appointment.status !== 'CANCELLED') throw new BadRequestException('Chỉ duyệt hoàn tiền cho lịch đã hủy');
      const invoice = await tx.invoice.findFirst({
        where: { issuedBranchId: actor.branchId, bookingOrderId: appointment.bookingOrderId }, select: { id: true },
      });
      if (!invoice) throw new NotFoundException('Không tìm thấy hóa đơn của lịch hẹn');
      await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoice.id}::uuid FOR UPDATE`;
      const payment = await tx.paymentTransaction.findFirst({
        where: { invoiceId: invoice.id, status: 'REFUND_REQUIRED' }, orderBy: { createdAt: 'desc' },
        select: { id: true, rawPayload: true },
      });
      if (!payment) throw new BadRequestException('Không có giao dịch đang yêu cầu hoàn tiền');
      const raw = payment.rawPayload as Record<string, Prisma.JsonValue> | null;
      const requests = raw?.appointmentRefunds as Record<string, Prisma.JsonValue> | undefined;
      const request = requests?.[appointmentId];
      if (!request || typeof request !== 'object' || Array.isArray(request)) throw new BadRequestException('Lịch hẹn chưa có yêu cầu hoàn tiền');
      if (request.approvalStatus === 'APPROVED') throw new ConflictException('Khoản hoàn đã được duyệt. Vui lòng tải lại danh sách');
      if (request.approvalStatus && request.approvalStatus !== 'PENDING_REVIEW') throw new ConflictException('Yêu cầu không còn ở trạng thái chờ duyệt');

      const quote = await getAppointmentRefundQuote(tx, { appointmentId, bookingOrderId: appointment.bookingOrderId, reason: 'Đối soát khi duyệt thủ công' });
      const paidAmount = quote.paidAmount;
      if (!quote.isPaid || paidAmount === null) throw new BadRequestException('Chưa đủ dữ liệu xác định khoản thực trả của lịch này. Cần đối soát trước khi duyệt');
      if (!Number.isSafeInteger(input.amount) || input.amount < 1 || input.amount > paidAmount) {
        throw new BadRequestException(`Số tiền hoàn phải từ 1 đ đến ${paidAmount.toLocaleString('vi-VN')} đ`);
      }
      const approved = {
        ...request, paidAmount, refundAmount: input.amount,
        refundRate: Math.round(input.amount / paidAmount * 10000) / 100,
        retainedAmount: paidAmount - input.amount, requiresManualReview: false,
        approvalStatus: 'APPROVED', approvalMethod: 'MANUAL', approvedAt: new Date().toISOString(),
        approvedBy: actor.id, approvalNote: input.note,
        ...(!request.refundBank && raw?.refundBank && Object.keys(requests!).length === 1 ? { refundBank: raw.refundBank } : {}),
      };
      await tx.paymentTransaction.update({
        where: { id: payment.id }, data: { rawPayload: {
          ...raw, appointmentRefunds: { ...requests, [appointmentId]: approved },
        } as Prisma.InputJsonValue },
      });
      await tx.outboxEvent.create({ data: {
        aggregateType: 'PaymentTransaction', aggregateId: payment.id, eventType: 'payment.refund.approved',
        payload: { appointmentId, paymentId: payment.id, invoiceId: invoice.id, amount: input.amount, approvedBy: actor.id, note: input.note } as Prisma.InputJsonValue,
      } });
      return { refund: approved, message: 'Đã duyệt khoản hoàn, đang chờ chuyển tiền cho bệnh nhân.' };
    });
  }
}
