import { appointmentTransaction, releaseCancelledHoldVoucher } from './helpers/appointment-mutation.helper.js';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { isUuid } from '../../common/utils/staff.utils.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { MailsService } from '../../infrastructure/mail/mails.service.js';
import { RealtimeGateway } from '../../infrastructure/realtime/realtime.gateway.js';
import { PACKAGE_RECEPTION_SELECT } from '../bookings/helpers/package-reception.helper.js';
import { requestAppointmentRefund } from '../payments/appointment-refund.js';
import { patientRecordScope } from '../patients/patient-record-scope.js';
import { RecommendationService } from '../recommendations/recommendation.service.js';
import {
  APPOINTMENT_STAFF_ROLES,
  AppointmentActor,
  RECEPTION_ROLES,
  appointmentScope,
  assertAppointmentAccess,
  loadAppointmentActor,
  computeQueueNumber,
  assertRescheduleDestination,
  releaseAppointmentSlot,
  transferAppointmentSlot,
  appointmentStatus,
  appointmentStatusFilter,
  assertAppointmentTransition,
  parseAppointmentDate,
  appointmentInclude,
  serialize,
} from './helpers/appointment.helper.js';

interface StatusInput { status?: string; cancelReason?: string; note?: string; visitQueueNumber?: number }
const MUTATION_INCLUDE = {
  receptionSlot: { select: { date: true, startTime: true, endTime: true } },
  patientProfile: { select: { id: true, fullName: true, account: { select: { email: true } } } },
  scheduleSlot: { include: { schedule: { include: { doctor: { select: { academicRank: true, user: { select: { fullName: true } } } }, branch: { select: { name: true } } } } } },
  servicePackage: { select: { name: true } }, branch: { select: { name: true } },
} satisfies Prisma.AppointmentInclude;

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailsService: MailsService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly recommendationService: RecommendationService,
  ) { }


  // Danh sách lịch khám của bác sĩ hiện tại
  async doctorAppointments(userId: string, query: { date?: string; status?: string } = {}) {
    const actor = await loadAppointmentActor(this.prisma, userId, ['CHAIN_MANAGER', 'DOCTOR']);
    const where: Prisma.AppointmentWhereInput = { AND: [appointmentScope(actor), appointmentStatusFilter(query.status)] };
    if (query.date) {
      const date = parseAppointmentDate(query.date);
      (where.AND as Prisma.AppointmentWhereInput[]).push({ scheduleSlot: { schedule: { workDate: date } } });
    }
    const rows = await this.prisma.appointment.findMany({
      where, include: appointmentInclude(),
      orderBy: [{ scheduleSlot: { schedule: { workDate: 'asc' } } }, { checkedInAt: 'asc' }, { queueNumber: 'asc' }, { createdAt: 'asc' }],
    });
    return { appointments: rows.map(serialize) };
  }

  // Danh sách lịch khám cho bộ phận tiếp nhận
  async receptionAppointments(userId: string, query: Record<string, string | undefined>) {
    const actor = await loadAppointmentActor(this.prisma, userId, RECEPTION_ROLES);
    const filters: Prisma.AppointmentWhereInput[] = [appointmentScope(actor), appointmentStatusFilter(query.status, true)];
    if (query.paymentChannel === 'counter') {
      filters.push({ OR: [
        { bookingOrder: { invoice: { payments: { some: {
          provider: 'CLINIC_COUNTER', status: { in: ['SUCCESS', 'REFUND_REQUIRED', 'REFUNDED'] }, method: { in: ['CASH', 'VIETQR'] },
        } } } } },
        { status: { in: ['HOLD', 'CONFIRMED'] }, bookingOrder: { invoice: {
          status: 'UNPAID', payments: { none: { status: { in: ['SUCCESS', 'REFUND_REQUIRED', 'REFUNDED'] } } },
        } } },
      ] });
    }
    const start = query.from ? parseAppointmentDate(query.from) : undefined;
    const end = query.to ? parseAppointmentDate(query.to) : undefined;
    if (start && end && start > end) throw new BadRequestException('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc');
    if (end) end.setUTCDate(end.getUTCDate() + 1);
    if (start || end) {
      const range = { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) };
      filters.push({
        OR: [
          { scheduleSlot: { schedule: { workDate: range } } }, { receptionSlot: { date: range } }, { checkedInAt: range }, { createdAt: range },
        ]
      });
    }
    const term = query.q?.trim();
    if (term) filters.push({
      OR: [
        { bookingCode: { contains: term, mode: 'insensitive' } },
        { patientProfile: { fullName: { contains: term, mode: 'insensitive' } } },
        { patientProfile: { nationalId: { contains: term, mode: 'insensitive' } } },
        { patientProfile: { phoneNumber: { contains: term, mode: 'insensitive' } } },
        { patientProfile: { patientCode: { contains: term, mode: 'insensitive' } } },
      ]
    });
    const rows = await this.prisma.appointment.findMany({
      where: { AND: filters }, include: appointmentInclude(), orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(Number.parseInt(query.limit || '', 10) || 200, 1), 500),
    });
    return { appointments: rows.map(serialize) };
  }



  // Tra cứu chính xác lịch khám bằng mã vé hoặc QR lịch hẹn
  async lookupTicket(userId: string, ticket: string) {
    const actor = await loadAppointmentActor(this.prisma, userId, APPOINTMENT_STAFF_ROLES);
    const scope = appointmentScope(actor);
    const value = String(ticket || '').trim();
    if (!value) throw new BadRequestException('Vui lòng nhập mã vé hoặc quét QR lịch hẹn');
    if (value.startsWith('VITACARE_CHECKIN:')) {
      const tokenHash = createHash('sha256').update(value.slice('VITACARE_CHECKIN:'.length)).digest('hex');
      const qr = await this.prisma.appointmentQrToken.findFirst({
        where: { tokenHash, appointment: scope }, include: { appointment: { include: appointmentInclude() } },
      });
      if (!qr) throw new NotFoundException('Không tìm thấy lịch hẹn phù hợp');
      return { appointment: serialize(qr.appointment) };
    }
    const row = await this.prisma.appointment.findFirst({
      where: {
        AND: [scope, { bookingCode: { equals: value, mode: 'insensitive' } }],
      },
      include: appointmentInclude(),
    });
    if (!row) throw new NotFoundException('Không tìm thấy lịch hẹn phù hợp');
    return { appointment: serialize(row) };
  }


  // list danh sách khám bệnh của bệnh nhân
  async patientHistory(userId: string, patientId: string) {
    if (!isUuid(patientId)) throw new BadRequestException('Mã hồ sơ bệnh nhân không hợp lệ');
    const profile = await this.prisma.patientProfile.findUnique({
      where: { id: patientId }, select: { id: true, accountId: true, nationalId: true, patientCode: true },
    });
    if (!profile) throw new NotFoundException('Không tìm thấy hồ sơ bệnh nhân');
    const recordScope = await patientRecordScope(this.prisma, userId, profile);
    const rows = await this.prisma.appointment.findMany({
      where: recordScope, include: appointmentInclude(), orderBy: { createdAt: 'desc' }, take: 50,
    });
    return { appointments: rows.map(serialize) };
  }

  async updateStatus(userId: string, appointmentId: string, input: StatusInput) {
    const actor = await loadAppointmentActor(this.prisma, userId, APPOINTMENT_STAFF_ROLES);
    return this.changeStatus(actor, appointmentId, input);
  }

  async finishMedicalVisit(userId: string, appointmentId: string) {
    const actor = await loadAppointmentActor(this.prisma, userId, ['CHAIN_MANAGER', 'DOCTOR']);
    return this.changeStatus(actor, appointmentId, { status: 'COMPLETED' });
  }

  private async changeStatus(actor: AppointmentActor, appointmentId: string, input: StatusInput) {
    const status = appointmentStatus(input.status);
    const current = await this.prisma.appointment.findUnique({ where: { id: appointmentId }, include: MUTATION_INCLUDE });
    if (!current) throw new NotFoundException('Không tìm thấy lịch khám');
    assertAppointmentAccess(actor, current);
    assertAppointmentTransition(current.status, status);
    if (actor.role === 'DOCTOR' && status !== 'COMPLETED' && !(status === 'CHECKED_IN' && current.status === 'CHECKED_IN')) {
      throw new ForbiddenException('Bác sĩ chỉ được xử lý lượt khám đã được phân công');
    }
    if (current.status === status && ['COMPLETED', 'CANCELLED'].includes(status)) {
      return { appointment: serialize(await this.prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId }, include: appointmentInclude() })) };
    }
    const requestedQueue = input.visitQueueNumber == null ? current.queueNumber : Number(input.visitQueueNumber);
    if (requestedQueue != null && (!Number.isInteger(requestedQueue) || requestedQueue < 1)) throw new BadRequestException('Số thứ tự phải là số nguyên dương');
    let refundRequested = false;
    const row = await appointmentTransaction(this.prisma, async tx => {
      if (current.status === 'HOLD' && status === 'CONFIRMED') {
        const paid = await tx.invoice.findFirst({
          where: { status: 'PAID', bookingOrderId: current.bookingOrderId }, select: { id: true },
        });
        if (!paid) throw new BadRequestException('Cần thanh toán trước khi xác nhận lịch khám');
      }
      const queueNumber = current.receptionSlotId ? null : status === 'CHECKED_IN' && requestedQueue == null
        ? await computeQueueNumber(tx, appointmentId, current.scheduleSlotId) : requestedQueue;
      const changed = await tx.appointment.updateMany({
        where: { id: appointmentId, status: current.status, scheduleSlotId: current.scheduleSlotId, rescheduleCount: current.rescheduleCount },
        data: {
          status, ...(queueNumber != null ? { queueNumber } : {}),
          ...(status === 'CONFIRMED' ? { holdExpiresAt: null } : {}),
          ...(status === 'CHECKED_IN' && current.status !== 'CHECKED_IN' ? { checkedInAt: new Date(), checkedInById: actor.id } : {})
        },
      });
      if (changed.count !== 1) throw new ConflictException('Lịch hẹn vừa được cập nhật, vui lòng tải lại');
      if (status === 'CANCELLED') {
        await releaseAppointmentSlot(tx, current.scheduleSlotId, current.receptionSlotId);
        refundRequested = !!(await requestAppointmentRefund(tx, {
          appointmentId, bookingOrderId: current.bookingOrderId, bookingCode: current.bookingCode,
          reason: input.cancelReason?.trim() || 'Phòng khám hủy lịch khám', isClinicCancelled: true,
        }));
        await releaseCancelledHoldVoucher(tx, current, refundRequested);
      }
      await tx.appointmentStatusHistory.create({
        data: {
          appointmentId, fromStatus: current.status, toStatus: status, actorId: actor.id,
          reason: input.cancelReason?.trim() || input.note?.trim() || null,
        }
      });
      return tx.appointment.findUniqueOrThrow({ where: { id: appointmentId }, include: appointmentInclude() });
    });
    if (status === 'CANCELLED') {
      const email = current.patientProfile.account?.email;
      if (email) {
        const slot = current.scheduleSlot;
        const doctor = slot?.schedule.doctor;
        const doctorName = doctor ? [doctor.academicRank, doctor.user.fullName].filter(Boolean).join(' ') : null;
        try {
          await this.mailsService.sendAppointmentCancellation({
            to: email, data: {
              patientName: current.patientProfile.fullName, bookingCode: current.bookingCode || current.id,
              appointmentDate: (current.receptionSlot?.date ?? slot?.schedule.workDate)?.toISOString().slice(0, 10) || '', startTime: (current.receptionSlot?.startTime ?? slot?.startTime)?.toISOString().slice(11, 16) || '',
              branchName: slot?.schedule.branch.name || current.branch.name,
              doctorOrServiceName: doctorName ? 'Bác sĩ ' + doctorName : current.servicePackage?.name || 'Khám chuyên khoa',
              cancelReason: input.cancelReason?.trim() || 'Phòng khám thay đổi lịch khám', cancelledBy: 'CLINIC',
              refundStatusNote: refundRequested ? 'Yêu cầu hoàn tiền đã được ghi nhận để bộ phận kế toán xử lý.' : undefined,
            }
          });
        } catch { /* A mail failure must not undo a committed status change. */ }
      }
    }
    try {
      this.realtimeGateway.emitAppointmentStatusChanged({ appointmentId, status: row.status, previousStatus: current.status, bookingCode: row.bookingCode, branchId: row.branchId });
    } catch { /* Realtime is best effort after commit. */ }
    if (status === 'COMPLETED' && current.status !== 'COMPLETED') {
      this.recommendationService.invalidateCache(current.patientProfileId).catch(() => { });
      this.recommendationService.triggerAsyncRecommendation(current.patientProfileId);
    }
    return { appointment: serialize(row) };
  }

  async executeSmartReschedule(userId: string, body: { items: Array<{ appointmentId: string; newSlotId: number }> }) {
    const actor = await loadAppointmentActor(this.prisma, userId, RECEPTION_ROLES);
    appointmentScope(actor);
    if (!body.items?.length || body.items.length > 100) throw new BadRequestException('Mỗi lần được đổi từ 1 đến 100 lịch khám');
    const results = [];
    for (const item of body.items) {
      try {
        results.push(await this.rescheduleForActor(actor, item.appointmentId, { newSlotId: item.newSlotId, note: 'DOCTOR_LEAVE_RESCHEDULE' }));
      } catch (error: unknown) {
        results.push({ appointmentId: item.appointmentId, success: false, error: error instanceof Error ? error.message : 'Không thể đổi lịch khám' });
      }
    }
    return { total: body.items.length, successCount: results.filter(result => result.success).length, results };
  }

  async adminReschedule(userId: string, appointmentId: string, body: { newSlotId: number; note?: string }) {
    const actor = await loadAppointmentActor(this.prisma, userId, RECEPTION_ROLES);
    return this.rescheduleForActor(actor, appointmentId, body);
  }

  private async rescheduleForActor(actor: AppointmentActor, appointmentId: string, body: { newSlotId: number; note?: string }) {
    if (!Number.isInteger(body.newSlotId) || body.newSlotId < 1) throw new BadRequestException('Vui lòng chọn khung giờ khám mới hợp lệ');
    return appointmentTransaction(this.prisma, async tx => {
      const appointment = await tx.appointment.findUnique({
        where: { id: appointmentId }, include: {
          scheduleSlot: { select: { schedule: { select: { doctorId: true } } } }, servicePackage: { select: PACKAGE_RECEPTION_SELECT },
          bookingMethod: { select: { code: true } },
        }
      });
      if (!appointment) throw new NotFoundException('Không tìm thấy lịch hẹn');
      assertAppointmentAccess(actor, appointment);
      const slot = await tx.doctorScheduleSlot.findUnique({
        where: { id: body.newSlotId }, include: {
          schedule: { select: { doctorId: true, branchId: true, workDate: true, status: true, doctor: { select: { id: true, isActive: true, user: { select: { fullName: true } } } } } },
        }
      });
      if (!slot) throw new NotFoundException('Không tìm thấy khung giờ khám mới');
      assertRescheduleDestination(appointment, slot);
      const updated = await transferAppointmentSlot(tx, appointment, slot, actor.id, body.note?.trim() || 'CLINIC_RESCHEDULE');
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'Appointment', aggregateId: appointmentId, eventType: 'appointment.rescheduled',
          payload: {
            appointmentId, oldSlotId: appointment.scheduleSlotId, newSlotId: slot.id,
            newAppointmentDate: slot.schedule.workDate.toISOString().slice(0, 10), newStartTime: slot.startTime.toISOString().slice(11, 16),
            newEndTime: slot.endTime.toISOString().slice(11, 16), queueNumber: updated.queueNumber, reason: body.note?.trim() || 'CLINIC_RESCHEDULE'
          },
        }
      });
      return {
        success: true, appointmentId, newDoctorName: slot.schedule.doctor.user.fullName,
        newDate: slot.schedule.workDate.toISOString().slice(0, 10), newTime: slot.startTime.toISOString().slice(11, 16)
      };
    });
  }
}
