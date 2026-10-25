import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUuid } from '../../common/utils/staff.utils.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { MailsService } from '../../infrastructure/mail/mails.service.js';
import { PACKAGE_RECEPTION_SELECT } from '../bookings/helpers/package-reception.helper.js';
import { requestAppointmentRefund } from '../payments/appointment-refund.js';
import { RescheduleAppointmentDto } from './dtos/reschedule-appointment.dto.js';
import { assertRescheduleDestination, releaseAppointmentSlot, transferAppointmentSlot, appointmentDateTime } from './helpers/appointment.helper.js';

const RESCHEDULE_SLOT_INCLUDE = {
  schedule: {
    include: {
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
          select: { orderCode: true, groupType: true, invoice: { select: { status: true, payments: { select: { status: true }, orderBy: { createdAt: 'desc' }, take: 1 } } } },
        },
        invoice: {
          select: {
            totalAmount: true,
            status: true,
            payments: {
              select: { status: true },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
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
        queueNumber: isTelehealth ? null : row.queueNumber,
        holdExpiresAt: row.holdExpiresAt,
        rescheduleCount: row.rescheduleCount ?? 0,
        createdAt: row.createdAt,
        appointmentDate: doctorSlot?.schedule.workDate?.toISOString().slice(0, 10) ?? null,
        startTime: doctorSlot?.startTime?.toISOString().slice(11, 16) ?? null,
        endTime: doctorSlot?.endTime?.toISOString().slice(11, 16) ?? null,
        scheduleSlotId: row.scheduleSlotId,
        servicePackageId: row.servicePackageId,
        isTelehealth,
        bookingMethod,
        patient: { id: row.patientProfile.id, fullName: row.patientProfile.fullName },
        doctor: (() => { const d = doctorSlot?.schedule?.doctor; return d ? { id: d.id, fullName: d.user?.fullName ?? '' } : null; })(),
        doctorId: doctorSlot?.schedule?.doctorId ?? null,
        specialty: doctorSlot?.schedule?.doctor?.specialties?.[0]?.specialty?.name ?? null,
        service: row.servicePackage ? { id: row.servicePackage.id, name: row.servicePackage.name } : null,
        healthPackage: row.servicePackage ? { id: row.servicePackage.id, name: row.servicePackage.name } : null,
        branch: branch ? { id: branch.id, name: branch.name, address: branch.address } : null,
        branchId: branch?.id ?? row.branchId,
        room: !isTelehealth && room ? { id: room.id, code: room.code, name: room.name } : null,
        totalAmount: Number(row.invoice?.totalAmount ?? row.servicePrice ?? 0),
        invoiceStatus: row.invoice?.status ?? row.bookingOrder?.invoice?.status ?? null,
        paymentStatus: row.invoice?.payments[0]?.status ?? row.bookingOrder?.invoice?.payments[0]?.status ?? null,
      };
    });
  }

  async cancelMyAppointment(
    accountId: string,
    appointmentId: string,
    inputOrReason?: string | { reason?: string; refundBank?: { bankCode?: string; bankName?: string; bankBin?: string; accountNumber?: string; accountName?: string } },
  ) {
    const reason = typeof inputOrReason === 'string' ? inputOrReason : inputOrReason?.reason;
    const refundBank = typeof inputOrReason === 'object' ? inputOrReason?.refundBank : undefined;

    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        bookingOrder: true,
        patientProfile: { include: { account: { select: { email: true } } } },
        scheduleSlot: { include: { schedule: { include: { doctor: { include: { user: true } }, branch: true } } } },
        servicePackage: true,
        branch: true,
      },
    });

    if (!appointment) throw new NotFoundException('Không tìm thấy lịch hẹn');

    // Kiểm tra quyền sở hữu lịch hẹn
    const isOwner = appointment.bookingOrder?.accountId === accountId || appointment.patientProfile?.accountId === accountId;
    if (!isOwner) throw new ForbiddenException('Bạn không có quyền hủy lịch hẹn này');

    // Chỉ cho phép hủy khi đang ở trạng thái BOOKED hoặc PENDING_PAYMENT
    if (!['CONFIRMED', 'HOLD'].includes(appointment.status)) {
      throw new BadRequestException(`Không thể hủy lịch hẹn đang ở trạng thái «${appointment.status}»`);
    }

    // Tính toán thời gian khám để kiểm tra tính cấp bách (sát giờ < 24h hoặc sau 16h30 ngày trước)
    const doctorSlot = appointment.scheduleSlot;
    const examDate = doctorSlot?.schedule?.workDate;
    const startTimeDate = doctorSlot?.startTime;

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

    await this.prisma.$transaction(async (tx) => {
      // 1. Cập nhật trạng thái Appointment -> CANCELLED
      const changed = await tx.appointment.updateMany({
        where: { id: appointmentId, status: previousStatus, scheduleSlotId: appointment.scheduleSlotId },
        data: { status: 'CANCELLED' },
      });
      if (changed.count !== 1) throw new ConflictException('Lịch hẹn vừa được cập nhật, vui lòng tải lại');

      // 2. Trả lại slot occupiedCount (giải phóng slot ngay lập tức)
      await releaseAppointmentSlot(tx, appointment.scheduleSlotId);

      isPaid = await requestAppointmentRefund(tx, {
        appointmentId: appointment.id, bookingOrderId: appointment.bookingOrderId,
        bookingCode: appointment.bookingCode, reason: reason?.trim() || 'Bệnh nhân tự hủy lịch khám',
        isUrgent, refundBank,
      });

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

    // 5. Gửi email xác nhận hủy lịch cho bệnh nhân
    const patientEmail = appointment.patientProfile?.account?.email;
    if (patientEmail) {
      const examDateStr = doctorSlot?.schedule?.workDate?.toISOString().slice(0, 10) ?? '';
      const startTimeStr = doctorSlot?.startTime?.toISOString().slice(11, 16) ?? '';
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
            refundStatusNote: isPaid
              ? (isUrgent ? 'Yêu cầu hoàn tiền đã được chuyển tới quản lý để xét duyệt do lịch bị hủy sát giờ khám.'
                : 'Yêu cầu hoàn tiền đã được ghi nhận. Bộ phận kế toán sẽ kiểm tra và xử lý theo khoản đã thanh toán.')
              : undefined,
          },
        });
      } catch {
        // Không block response nếu email lỗi
      }
    }

    return {
      success: true,
      isUrgent,
      message: !isPaid ? 'Hủy lịch khám thành công. Slot khám đã được giải phóng.'
        : isUrgent ? 'Hủy lịch khám thành công. Yêu cầu hoàn tiền đã được chuyển tới quản lý để xét duyệt.'
          : 'Hủy lịch khám thành công. Yêu cầu hoàn tiền đã được ghi nhận để bộ phận kế toán xử lý.',
    };
  }

  async rescheduleMyAppointment(accountId: string, appointmentId: string, dto: RescheduleAppointmentDto) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        bookingOrder: true,
        patientProfile: { include: { account: { select: { email: true } } } },
        scheduleSlot: { include: { schedule: { include: { doctor: { include: { user: true } }, branch: true, room: true } } } },
        servicePackage: { select: PACKAGE_RECEPTION_SELECT },
        branch: true,
      },
    });

    if (!appointment) throw new NotFoundException('Không tìm thấy lịch hẹn');

    // 1. Kiểm tra quyền sở hữu lịch hẹn
    const isOwner = appointment.bookingOrder?.accountId === accountId || appointment.patientProfile?.accountId === accountId;
    if (!isOwner) throw new ForbiddenException('Bạn không có quyền đổi lịch hẹn này');

    // 2. Chỉ cho phép đổi khi đang ở trạng thái BOOKED
    if (appointment.status !== 'CONFIRMED') {
      throw new BadRequestException(`Không thể đổi lịch hẹn đang ở trạng thái «${appointment.status}». Chỉ áp dụng cho lịch đã xác nhận.`);
    }

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
    if (!isUuid(dto.newScheduleSlotId)) throw new BadRequestException('Vui lòng chọn khung giờ khám đã được tạo sẵn');
    const newSlot = await this.prisma.doctorScheduleSlot.findUnique({
      where: { id: dto.newScheduleSlotId },
      include: RESCHEDULE_SLOT_INCLUDE,
    });

    if (!newSlot) throw new NotFoundException('Khung giờ khám mới không khả dụng');
    assertRescheduleDestination(appointment, newSlot, now);
    const newDateStr = newSlot.schedule.workDate.toISOString().slice(0, 10);
    const newTimeStr = newSlot.startTime.toISOString().slice(11, 16);

    // 6. Thực thi chuyển đổi nguyên tử (Atomic Transfer Transaction)
    const result = await this.prisma.$transaction(async (tx) => {
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

      return {
        success: true,
        message: 'Đổi lịch khám thành công',
        appointmentId: updated.id,
        bookingCode: updated.bookingCode,
        newDate: newDateStr,
        newTime: `${newTimeStr} - ${newSlot.endTime.toISOString().slice(11, 16)}`,
        newQueueNumber,
        rescheduleCount: updated.rescheduleCount,
      };
    });

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
}
