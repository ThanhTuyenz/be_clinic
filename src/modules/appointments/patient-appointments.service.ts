import { appointmentTransaction, releaseCancelledHoldVoucher } from './helpers/appointment-mutation.helper.js';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { MailsService } from '../../infrastructure/mail/mails.service.js';
import { assertPackageReception, PACKAGE_RECEPTION_SELECT } from '../bookings/helpers/package-reception.helper.js';
import { onlineBookingDateRange } from '../bookings/helpers/booking-date.helper.js';
import { getAppointmentRefundQuote, requestAppointmentRefund, type AppointmentRefundQuote } from '../payments/appointment-refund.js';
import { CancelAppointmentDto } from './dtos/cancel-appointment.dto.js';
import { PATIENT_CANCELLATION_REASONS } from './cancellation-reasons.js';
import { RescheduleAppointmentDto } from './dtos/reschedule-appointment.dto.js';
import { assertPatientSlotAvailable, assertRescheduleDestination, releaseAppointmentSlot, transferAppointmentSlot, appointmentDateTime } from './helpers/appointment.helper.js';

const PATIENT_MUTATION_INCLUDE = {
  receptionSlot: { select: { date: true, startTime: true, endTime: true } },
  bookingMethod: { select: { code: true } },
  bookingOrder: { select: { accountId: true } },
  patientProfile: { select: { id: true, accountId: true, fullName: true, account: { select: { email: true } } } },
  scheduleSlot: { include: { schedule: { select: {
    doctorId: true, workDate: true,
    doctor: { select: { academicRank: true, user: { select: { fullName: true } } } },
    branch: { select: { name: true } },
  } } } },
  servicePackage: { select: { name: true } },
  branch: { select: { name: true, address: true } },
} satisfies Prisma.AppointmentInclude;

function assertUpcomingPatientAppointment(appointment: {
  receptionSlot?: { date: Date; startTime: Date } | null;
  scheduleSlot?: { startTime: Date; schedule: { workDate: Date } } | null;
}) {
  const date = appointment.receptionSlot?.date ?? appointment.scheduleSlot?.schedule.workDate;
  const time = appointment.receptionSlot?.startTime ?? appointment.scheduleSlot?.startTime;
  if (!date || !time) throw new BadRequestException('Không xác định được giờ khám. Vui lòng liên hệ phòng khám để được hỗ trợ.');
  if (appointmentDateTime(date, time).getTime() <= Date.now()) {
    throw new BadRequestException('Lịch hẹn đã đến hoặc qua giờ khám, không thể đổi hoặc hủy trực tuyến.');
  }
}

const RESCHEDULE_SLOT_INCLUDE = {
  schedule: {
    select: {
      doctorId: true, branchId: true, workDate: true, status: true,
      doctor: { select: { id: true, isActive: true, academicRank: true, user: { select: { fullName: true } } } },
      branch: { select: { id: true, name: true, address: true } }, room: { select: { code: true, name: true } },
    }
  },
} satisfies Prisma.DoctorScheduleSlotInclude;

@Injectable()
export class PatientAppointmentsService {
  constructor(private readonly prisma: PrismaService, private readonly mailsService: MailsService) { }

  async myAppointments(accountId: string) {
    const rows = await this.prisma.appointment.findMany({
      where: {
        NOT: {
          status: 'CANCELLED',
          statusHistories: {
            some: { fromStatus: 'HOLD', toStatus: 'CANCELLED' },
            none: { OR: [{ fromStatus: 'CONFIRMED' }, { toStatus: 'CONFIRMED' }] },
          },
        },
        OR: [
          { patientProfile: { accountId } },
          { bookingOrder: { accountId } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        bookingCode: true,
        bookingOrderId: true,
        status: true,
        queueNumber: true,
        holdExpiresAt: true,
        rescheduleCount: true,
        createdAt: true,
        servicePrice: true,
        servicePackageId: true,
        scheduleSlotId: true,
        receptionSlotId: true,
        receptionSlot: { select: { date: true, startTime: true, endTime: true } },
        branchId: true,
        symptomsDescription: true,
        bookingMethod: {
          select: { id: true, code: true, name: true },
        },
        patientProfile: {
          select: { id: true, fullName: true },
        },
        servicePackage: {
          select: {
            id: true,
            name: true,
            code: true,
            branchBookingMethod: {
              select: {
                bookingMethod: { select: { code: true, name: true } },
              },
            },
          },
        },
        telehealthSession: {
          select: { id: true },
        },
        branch: {
          select: { id: true, name: true, address: true },
        },
        bookingOrder: {
          select: { orderCode: true, groupType: true, invoice: { select: { totalAmount: true, status: true, payments: { select: { status: true }, orderBy: { createdAt: 'desc' }, take: 1 } } } },
        },
        scheduleSlot: {
          select: {
            startTime: true,
            endTime: true,
            schedule: {
              select: {
                workDate: true,
                doctorId: true,
                doctor: {
                  select: {
                    id: true,
                    user: { select: { fullName: true } },
                    specialties: {
                      take: 1,
                      select: { specialty: { select: { name: true } } },
                    },
                  },
                },
                room: {
                  select: { id: true, code: true, name: true },
                },
              },
            },
          },
        },
      },
    });
    return rows.map((row) => {
      const doctorSlot = row.scheduleSlot;
      const room = doctorSlot?.schedule.room;
      const branch = row.branch;
      const bookingMethod = row.bookingMethod
        ? { code: row.bookingMethod.code, name: row.bookingMethod.name }
        : row.servicePackage?.branchBookingMethod?.bookingMethod
          ? { code: row.servicePackage.branchBookingMethod.bookingMethod.code, name: row.servicePackage.branchBookingMethod.bookingMethod.name }
          : null;

      const isTelehealth = Boolean(
        row.telehealthSession ||
        bookingMethod?.code === 'ONLINE_CONSULTATION'
      );

      return {
        id: row.id,
        bookingCode: row.bookingCode,
        bookingOrderId: row.bookingOrderId,
        orderCode: row.bookingOrder?.orderCode ?? null,
        groupType: row.bookingOrder?.groupType ?? null,
        status: row.status,
        queueNumber: row.queueNumber,
        holdExpiresAt: row.holdExpiresAt,
        rescheduleCount: row.rescheduleCount ?? 0,
        createdAt: row.createdAt,
        appointmentDate: (row.receptionSlot?.date ?? doctorSlot?.schedule.workDate)?.toISOString().slice(0, 10) ?? null,
        startTime: (row.receptionSlot?.startTime ?? doctorSlot?.startTime)?.toISOString().slice(11, 16) ?? null,
        endTime: (row.receptionSlot?.endTime ?? doctorSlot?.endTime)?.toISOString().slice(11, 16) ?? null,
        receptionSlotId: row.receptionSlotId,
        scheduleSlotId: row.scheduleSlotId,
        servicePackageId: row.servicePackageId,
        isTelehealth,
        bookingMethod,
        patient: { id: row.patientProfile.id, fullName: row.patientProfile.fullName },
        doctor: (() => { const d = doctorSlot?.schedule?.doctor; return d ? { id: d.id, fullName: d.user?.fullName ?? '' } : null; })(),
        doctorId: doctorSlot?.schedule?.doctorId ?? null,
        specialty: doctorSlot?.schedule?.doctor?.specialties?.[0]?.specialty?.name ?? null,
        service: row.servicePackage ? { id: row.servicePackage.id, name: row.servicePackage.name } : null,
        healthPackage: bookingMethod?.code === 'HEALTH_PACKAGE' && row.servicePackage
          ? { id: row.servicePackage.id, name: row.servicePackage.name }
          : null,
        branch: branch ? { id: branch.id, name: branch.name, address: branch.address } : null,
        branchId: branch?.id ?? row.branchId,
        room: !isTelehealth && room ? { id: room.id, code: room.code, name: room.name } : null,
        totalAmount: Number(row.bookingOrder.invoice?.totalAmount ?? row.servicePrice),
        invoiceStatus: row.bookingOrder.invoice?.status ?? null,
        paymentStatus: row.bookingOrder.invoice?.payments[0]?.status ?? null,
      };
    });
  }

  async cancellationQuote(accountId: string, appointmentId: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId }, include: PATIENT_MUTATION_INCLUDE,
    });
    if (!appointment) throw new NotFoundException('Không tìm thấy lịch hẹn');
    if (appointment.bookingOrder?.accountId !== accountId && appointment.patientProfile.accountId !== accountId) {
      throw new ForbiddenException('Bạn không có quyền hủy lịch hẹn này');
    }
    if (!['CONFIRMED', 'HOLD'].includes(appointment.status)) throw new BadRequestException('Lịch hẹn không còn ở trạng thái có thể hủy');
    assertUpcomingPatientAppointment(appointment);
    const quote = await this.prisma.$transaction(tx => getAppointmentRefundQuote(tx, {
      appointmentId, bookingOrderId: appointment.bookingOrderId, reason: 'Xem trước khoản hoàn',
    }));
    return { ...quote, cancellationReasons: PATIENT_CANCELLATION_REASONS };
  }

  async cancelMyAppointment(
    accountId: string,
    appointmentId: string,
    inputOrReason?: string | CancelAppointmentDto,
  ) {
    const reason = typeof inputOrReason === 'string' ? inputOrReason : inputOrReason?.reason;
    if (!PATIENT_CANCELLATION_REASONS.some(option => option === reason)) {
      throw new BadRequestException('Vui lòng chọn lý do hủy trong danh sách có sẵn');
    }
    const refundBank = typeof inputOrReason === 'object' ? inputOrReason?.refundBank : undefined;
    const expectedRefundQuote = typeof inputOrReason === 'object' ? inputOrReason.expectedRefundQuote : undefined;

    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: PATIENT_MUTATION_INCLUDE,
    });

    if (!appointment) throw new NotFoundException('Không tìm thấy lịch hẹn');

    // Kiểm tra quyền sở hữu lịch hẹn
    const isOwner = appointment.bookingOrder?.accountId === accountId || appointment.patientProfile?.accountId === accountId;
    if (!isOwner) throw new ForbiddenException('Bạn không có quyền hủy lịch hẹn này');

    // Chỉ cho phép hủy khi lịch đã giữ chỗ hoặc xác nhận
    if (!['CONFIRMED', 'HOLD'].includes(appointment.status)) {
      throw new BadRequestException(`Không thể hủy lịch hẹn đang ở trạng thái «${appointment.status}»`);
    }
    assertUpcomingPatientAppointment(appointment);

    // Mark cancellations within 24 hours; refund approval uses the separate 24h/2h policy.
    const doctorSlot = appointment.scheduleSlot;
    const examDate = appointment.receptionSlot?.date ?? doctorSlot?.schedule?.workDate;
    const startTimeDate = appointment.receptionSlot?.startTime ?? doctorSlot?.startTime;

    const now = new Date();
    let isUrgent = false;

    if (examDate && startTimeDate) {
      const examTime = appointmentDateTime(examDate, startTimeDate);

      const hoursUntilExam = (examTime.getTime() - now.getTime()) / (1000 * 60 * 60);

      // Nếu dưới 24h -> Coi là hủy gấp
      if (hoursUntilExam < 24) {
        isUrgent = true;
      }
    }

    const previousStatus = appointment.status;
    let isPaid = false;
    let refund: AppointmentRefundQuote | null = null;

    await appointmentTransaction(this.prisma, async (tx) => {
      assertUpcomingPatientAppointment(appointment);
      // 1. Cập nhật trạng thái Appointment -> CANCELLED
      const changed = await tx.appointment.updateMany({
        where: { id: appointmentId, status: previousStatus, scheduleSlotId: appointment.scheduleSlotId, receptionSlotId: appointment.receptionSlotId, rescheduleCount: appointment.rescheduleCount },
        data: { status: 'CANCELLED' },
      });
      if (changed.count !== 1) throw new ConflictException('Lịch hẹn vừa được cập nhật, vui lòng tải lại');

      // 2. Trả lại slot occupiedCount (giải phóng slot ngay lập tức)
      await releaseAppointmentSlot(tx, appointment.scheduleSlotId, appointment.receptionSlotId);

      refund = await requestAppointmentRefund(tx, {
        appointmentId: appointment.id, bookingOrderId: appointment.bookingOrderId,
        bookingCode: appointment.bookingCode, reason: reason?.trim() || 'Bệnh nhân tự hủy lịch khám',
        isUrgent, refundBank, expectedRefundQuote,
      });
      isPaid = !!refund;

      await releaseCancelledHoldVoucher(tx, appointment, isPaid);

      // 4. Ghi nhận lịch sử trạng thái
      await tx.appointmentStatusHistory.create({
        data: {
          appointmentId: appointment.id,
          fromStatus: previousStatus,
          toStatus: 'CANCELLED',
          actorId: accountId,
          reason: reason ? `Bệnh nhân hủy: ${reason}${isUrgent ? ' (HỦY GẤP)' : ''}` : `Bệnh nhân tự hủy lịch${isUrgent ? ' (HỦY GẤP)' : ''}`,
        },
      });
    });

    // The transaction callback assigns the quote only after a successful cancellation.
    const refundResult = refund as AppointmentRefundQuote | null;
    const refundStatusNote = !refundResult ? undefined : refundResult.refundAmount === 0
      ? 'Lịch đã hủy nhưng không đủ điều kiện hoàn tiền theo chính sách (dưới 2 giờ hoặc thiếu dữ liệu tính tiền).'
      : refundResult.requiresManualReview
      ? 'Yêu cầu hoàn tiền đang chờ quản lý chi nhánh xét duyệt. Chưa thực hiện hoàn tiền.'
      : `Khoản hoàn ${refundResult.refundRate}% (${refundResult.refundAmount!.toLocaleString('vi-VN')} đ) đã được tự động duyệt, đang chờ nhân viên chuyển tiền.`;

    // 5. Gửi email xác nhận hủy lịch cho bệnh nhân
    const patientEmail = appointment.patientProfile?.account?.email;
    if (patientEmail) {
      const examDateStr = examDate?.toISOString().slice(0, 10) ?? '';
      const startTimeStr = startTimeDate?.toISOString().slice(11, 16) ?? '';
      const doctorName = doctorSlot?.schedule?.doctor
        ? `${doctorSlot.schedule.doctor.academicRank ? doctorSlot.schedule.doctor.academicRank + ' ' : ''}${doctorSlot.schedule.doctor.user?.fullName ?? ''}`.trim()
        : null;
      const serviceName = appointment.servicePackage?.name || null;
      const branchName = doctorSlot?.schedule?.branch?.name || appointment.branch?.name || 'VitaCare Clinic';

      try {
        await this.mailsService.sendAppointmentCancellation({
          to: patientEmail,
          data: {
            patientName: appointment.patientProfile.fullName,
            bookingCode: appointment.bookingCode || appointment.id,
            appointmentDate: examDateStr,
            startTime: startTimeStr,
            branchName,
            doctorOrServiceName: doctorName ? `Bác sĩ ${doctorName}` : (serviceName || 'Khám chuyên khoa'),
            cancelReason: reason || 'Bệnh nhân có việc bận cá nhân',
            cancelledBy: 'PATIENT',
            refundStatusNote,
          },
        });
      } catch {
        // Không block response nếu email lỗi
      }
    }

    return {
      success: true,
      isUrgent,
      refund: refundResult,
      message: !isPaid ? 'Hủy lịch khám thành công. Slot khám đã được giải phóng.'
        : `Hủy lịch khám thành công. ${refundStatusNote}`,
    };
  }

  async rescheduleMyAppointment(accountId: string, appointmentId: string, dto: RescheduleAppointmentDto) {
    if (dto.newReceptionSlotId) return this.rescheduleReception(accountId, appointmentId, dto);
    const { result, appointment, newSlot } = await appointmentTransaction(this.prisma, async (tx) => {
      const appointment = await tx.appointment.findUnique({
        where: { id: appointmentId },
        include: { ...PATIENT_MUTATION_INCLUDE, servicePackage: { select: PACKAGE_RECEPTION_SELECT } },
      });

      if (!appointment) throw new NotFoundException('Không tìm thấy lịch hẹn');
      if (appointment.receptionSlotId) throw new BadRequestException('Vui lòng chọn khung tiếp nhận mới cho gói khám');

      // 1. Kiểm tra quyền sở hữu lịch hẹn
      const isOwner = appointment.bookingOrder?.accountId === accountId || appointment.patientProfile?.accountId === accountId;
      if (!isOwner) throw new ForbiddenException('Bạn không có quyền đổi lịch hẹn này');

      // 2. Chỉ cho phép đổi khi lịch đã xác nhận
      if (appointment.status !== 'CONFIRMED') {
        throw new BadRequestException(`Không thể đổi lịch hẹn đang ở trạng thái «${appointment.status}». Chỉ áp dụng cho lịch đã xác nhận.`);
      }
      assertUpcomingPatientAppointment(appointment);

      // 3. Kiểm tra số lần đổi lịch (tối đa 2 lần)
      if (appointment.rescheduleCount >= 2) {
        throw new BadRequestException('Lịch hẹn này đã đạt giới hạn tối đa 2 lần đổi lịch.');
      }

      // 4. Kiểm tra thời gian tối thiểu 6 giờ (hoặc ân hạn 30 phút sau khi đặt)
      const oldSlot = appointment.scheduleSlot;
      const oldWorkDate = oldSlot?.schedule?.workDate;
      const oldStartTime = oldSlot?.startTime;

      const now = new Date();
      const createdRecently = (now.getTime() - appointment.createdAt.getTime()) <= 30 * 60 * 1000; // Trong vòng 30 phút sau khi đặt

      if (!createdRecently && oldWorkDate && oldStartTime) {
        const apptDateTime = appointmentDateTime(oldWorkDate, oldStartTime);
        const hoursUntilExam = (apptDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);

        if (hoursUntilExam < 6) {
          throw new BadRequestException('Chỉ được đổi lịch trước giờ khám ít nhất 6 giờ. Lịch khám của bạn đã quá sát giờ, vui lòng liên hệ hotline phòng khám để được hỗ trợ.');
        }
      }

      // 5. Xác thực slot mới
      if (!Number.isInteger(dto.newScheduleSlotId) || dto.newScheduleSlotId < 1) throw new BadRequestException('Vui lòng chọn khung giờ khám đã được tạo sẵn');
      const newSlot = await tx.doctorScheduleSlot.findUnique({
        where: { id: dto.newScheduleSlotId },
        include: RESCHEDULE_SLOT_INCLUDE,
      });

      if (!newSlot) throw new NotFoundException('Khung giờ khám mới không khả dụng');
      assertRescheduleDestination(appointment, newSlot, now);
      const newDateStr = newSlot.schedule.workDate.toISOString().slice(0, 10);
      const newTimeStr = newSlot.startTime.toISOString().slice(11, 16);

      // 6. Thực thi chuyển đổi nguyên tử (Atomic Transfer Transaction)
      const updated = await transferAppointmentSlot(tx, appointment, newSlot, accountId,
        `RESCHEDULED: Đổi từ slot [${oldSlot?.startTime?.toISOString().slice(11, 16)} ${oldWorkDate?.toISOString().slice(0, 10)}] sang [${newTimeStr} ${newDateStr}]. Lý do: ${dto.reason?.trim() || 'Người bệnh yêu cầu đổi lịch'}`);
      const newQueueNumber = updated.queueNumber;

      // 6e. Tạo sự kiện Outbox thông báo
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'Appointment',
          aggregateId: appointmentId,
          eventType: 'appointment.rescheduled',
          payload: {
            appointmentId,
            oldSlotId: oldSlot?.id,
            newSlotId: newSlot.id,
            newAppointmentDate: newDateStr,
            newStartTime: newTimeStr,
            newEndTime: newSlot.endTime.toISOString().slice(11, 16),
            queueNumber: newQueueNumber,
            reason: dto.reason?.trim(),
          },
        },
      });

      const result = {
        success: true,
        message: 'Đổi lịch khám thành công',
        appointmentId: updated.id,
        bookingCode: updated.bookingCode,
        newDate: newDateStr,
        newTime: `${newTimeStr} - ${newSlot.endTime.toISOString().slice(11, 16)}`,
        newQueueNumber,
        rescheduleCount: updated.rescheduleCount,
      };
      return { result, appointment, newSlot };
    });
    const newTimeStr = newSlot.startTime.toISOString().slice(11, 16);

    // 7. Gửi email thông báo đổi lịch cho bệnh nhân
    const patientEmail = appointment.patientProfile?.account?.email;
    if (patientEmail) {
      const docName = newSlot.schedule?.doctor
        ? `${newSlot.schedule.doctor.academicRank ? newSlot.schedule.doctor.academicRank + ' ' : ''}${newSlot.schedule.doctor.user?.fullName ?? ''}`.trim()
        : null;
      const serviceName = appointment.servicePackage?.name || null;
      const branchName = newSlot.schedule?.branch?.name || appointment.branch?.name || 'VitaCare Clinic';
      const branchAddress = newSlot.schedule?.branch?.address || appointment.branch?.address || '';
      const roomName = newSlot.schedule?.room?.name ? `${newSlot.schedule.room.code} · ${newSlot.schedule.room.name}` : null;

      try {
        await this.mailsService.sendAppointmentRescheduled({
          to: patientEmail,
          data: {
            patientName: appointment.patientProfile.fullName,
            bookingCode: appointment.bookingCode || appointment.id,
            newAppointmentDate: result.newDate,
            newStartTime: newTimeStr,
            newEndTime: newSlot.endTime.toISOString().slice(11, 16),
            branchName,
            branchAddress,
            doctorOrServiceName: docName ? `Bác sĩ ${docName}` : (serviceName || 'Khám chuyên khoa'),
            roomName,
            queueNumber: result.newQueueNumber,
            reason: dto.reason?.trim() || null,
          },
        });
      } catch {
        // Không block response nếu email gửi lỗi
      }
    }

    return result;
  }

  private async rescheduleReception(accountId: string, appointmentId: string, dto: RescheduleAppointmentDto) {
    if (dto.newScheduleSlotId) throw new BadRequestException('Gói tổng quát chỉ sử dụng khung tiếp nhận');
    return appointmentTransaction(this.prisma, async tx => {
      const appointment = await tx.appointment.findUnique({ where: { id: appointmentId }, include: { ...PATIENT_MUTATION_INCLUDE, servicePackage: { select: PACKAGE_RECEPTION_SELECT } } });
      if (!appointment || (appointment.patientProfile.accountId !== accountId && appointment.bookingOrder?.accountId !== accountId)) throw new ForbiddenException('Không có quyền đổi lịch hẹn');
      if (appointment.bookingMethod?.code !== 'HEALTH_PACKAGE' || appointment.status !== 'CONFIRMED' || appointment.rescheduleCount >= 2) throw new BadRequestException('Lịch hẹn không đủ điều kiện đổi khung tiếp nhận');
      assertUpcomingPatientAppointment(appointment);
      const oldDate = appointment.receptionSlot?.date ?? appointment.scheduleSlot?.schedule.workDate;
      const oldTime = appointment.receptionSlot?.startTime ?? appointment.scheduleSlot?.startTime;
      if (!oldDate || !oldTime || (Date.now() - appointment.createdAt.getTime() > 1800000 && appointmentDateTime(oldDate, oldTime).getTime() - Date.now() < 6 * 3600000)) throw new BadRequestException('Chỉ được đổi trước giờ tiếp nhận ít nhất 6 giờ');
      const slot = await tx.packageReceptionSlot.findUnique({ where: { id: dto.newReceptionSlotId! } });
      if (!slot?.isActive || slot.id === appointment.receptionSlotId || slot.branchId !== appointment.branchId || slot.servicePackageId !== appointment.servicePackageId) throw new BadRequestException('Khung tiếp nhận mới không hợp lệ');
      onlineBookingDateRange(60).resolveDate(slot.date.toISOString().slice(0, 10));
      assertPackageReception(appointment.servicePackage!.receptionSchedules, { startTime: slot.startTime, schedule: { branchId: slot.branchId, workDate: slot.date } });
      await assertPatientSlotAvailable(tx, appointment.patientProfileId, { startTime: slot.startTime, endTime: slot.endTime, schedule: { workDate: slot.date } }, appointment.id);
      const reserved = await tx.$executeRaw`UPDATE package_reception_slots SET occupied_count = occupied_count + 1, updated_at = NOW() WHERE id = ${slot.id} AND is_active = true AND occupied_count < capacity`;
      if (reserved !== 1) throw new ConflictException('Khung tiếp nhận mới vừa hết chỗ');
      await releaseAppointmentSlot(tx, appointment.scheduleSlotId, appointment.receptionSlotId);
      const updated = await tx.appointment.update({ where: { id: appointment.id }, data: {
        receptionSlotId: slot.id, scheduleSlotId: null, queueNumber: null, rescheduleCount: { increment: 1 }, reminderSent24h: false, reminderSent2h: false,
        statusHistories: { create: { fromStatus: appointment.status, toStatus: appointment.status, actorId: accountId, reason: `Đổi giờ tiếp nhận: ${dto.reason?.trim() || 'Người bệnh yêu cầu'}` } },
      } });
      const newDate = slot.date.toISOString().slice(0, 10), newTime = `${slot.startTime.toISOString().slice(11, 16)} - ${slot.endTime.toISOString().slice(11, 16)}`;
      await tx.outboxEvent.create({ data: { aggregateType: 'Appointment', aggregateId: appointment.id, eventType: 'appointment.rescheduled', payload: { appointmentId, newAppointmentDate: newDate, newStartTime: slot.startTime.toISOString().slice(11, 16), newEndTime: slot.endTime.toISOString().slice(11, 16), newReceptionSlotId: slot.id } } });
      return { success: true, message: 'Đã đổi giờ tiếp nhận gói khám', appointmentId, bookingCode: updated.bookingCode, newDate, newTime, newQueueNumber: null, rescheduleCount: updated.rescheduleCount };
    });
  }
}
