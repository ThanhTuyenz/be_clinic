import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppointmentStatus, NotificationType, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { RealtimeGateway } from '../../infrastructure/realtime/realtime.gateway.js';
import { NotificationService } from '../notifications/notification.service.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { checkInToken } from './helpers/check-in-token.js';

export const CONFIRMATION_INCLUDE = {
  patientProfile: true,
  servicePackage: { include: { specialty: true } },
  branch: true,
  scheduleSlot: { include: { schedule: { include: { doctor: { include: { user: true } } } } } },
} as const;
export type ConfirmedAppointment = Prisma.AppointmentGetPayload<{ include: typeof CONFIRMATION_INCLUDE }>;

@Injectable()
export class AppointmentConfirmationService {
  constructor(
    private readonly config: ConfigService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly notifications: NotificationService,
    private readonly prisma: PrismaService,
  ) { }


  // xác nhận lịch hẹn trạng thái confirm
  async confirmSingleAppointment(
    tx: Prisma.TransactionClient,
    appointmentId: string,
    assignedQueueNumber: number | null,
    fromStatus: AppointmentStatus,
    historyReason: string,
    bookingOrderId?: string,
  ) {
    const rawToken = checkInToken(appointmentId, this.config.get<string>('auth.secret'));
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const bookingCode = `VC-${appointmentId.slice(0, 8).toUpperCase()}`;

    const updated = await tx.appointment.update({
      where: { id: appointmentId },
      data: {
        status: 'CONFIRMED',
        bookingCode,
        queueNumber: assignedQueueNumber,
        holdExpiresAt: null,
        statusHistories: { create: { fromStatus, toStatus: 'CONFIRMED', reason: historyReason } },
      },
      include: CONFIRMATION_INCLUDE,
    });

    await tx.appointmentQrToken.upsert({
      where: { appointmentId },
      update: { tokenHash, expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000), usedAt: null },
      create: { appointmentId, tokenHash, expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000) },
    });

    await tx.outboxEvent.create({
      data: {
        aggregateType: 'Appointment',
        aggregateId: appointmentId,
        eventType: 'appointment.booked',
        payload: { appointmentId, bookingCode, ...(bookingOrderId ? { bookingOrderId } : {}), queueNumber: assignedQueueNumber },
      },
    });

    return { rawToken, updated };
  }



  async notifyConfirmedAppointment(updated: ConfirmedAppointment) {
    const appointmentId = updated.id;
    const bookingCode = updated.bookingCode!;
    const assignedQueueNumber = updated.queueNumber;
    // Bắn sự kiện realtime socket tới Quầy tiếp đón & Bác sĩ
    try {
      const isHealthPkg = Boolean(updated.servicePackageId && !updated.servicePackage?.specialtyId);
      const servicePackageName = updated.servicePackage?.name;
      const specialtyName = updated.servicePackage?.specialty?.name;
      const assignedDoctor = updated.scheduleSlot?.schedule?.doctor;

      this.realtimeGateway.emitAppointmentBooked({
        appointmentId,
        bookingCode,
        queueNumber: assignedQueueNumber ?? undefined,
        patientName: updated.patientProfile?.fullName,
        patientPhone: updated.patientProfile?.phoneNumber,
        doctorId: assignedDoctor?.id,
        doctorName: assignedDoctor?.user?.fullName,
        specialtyName,
        servicePackageName,
        packageName: servicePackageName,
        bookingType: isHealthPkg ? 'HEALTH_PACKAGE' : (updated.servicePackageId ? 'SERVICE_PACKAGE' : 'DOCTOR'),
        branchId: updated.branchId,
        branchName: updated.branch?.name,
        appointmentDate: updated.scheduleSlot?.schedule?.workDate?.toISOString().slice(0, 10),
        startTime: updated.scheduleSlot?.startTime?.toISOString().slice(11, 16),
        endTime: updated.scheduleSlot?.endTime?.toISOString().slice(11, 16),
        status: 'CONFIRMED',
      });

      // Gửi thông báo trong ứng dụng cho tài khoản bệnh nhân
      if (updated.patientProfile?.accountId) {
        await this.notifications.createNotification({
          userId: updated.patientProfile.accountId,
          title: 'Đặt lịch khám thành công!',
          content: `Lịch khám #${bookingCode} đã được xác nhận. Ngày khám: ${updated.scheduleSlot?.schedule?.workDate?.toISOString().slice(0, 10) || ''} (${updated.scheduleSlot?.startTime?.toISOString().slice(11, 16) || ''}) tại ${updated.branch?.name || 'VitaCare Clinic'}.`,
          type: NotificationType.BOOKING_CONFIRMED,
          data: { appointmentId, bookingCode, branchName: updated.branch?.name },
        }).catch(() => { });
      }
    } catch {
      // Ignore socket emit error
    }

  }



  // return pass check-in cho lịch hẹn 
  async issueCheckInPass(appointmentId: string, accountId: string) {
    const row = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, OR: [{ patientProfile: { accountId } }, { bookingOrder: { accountId } }] },
      select: {
        id: true,
        bookingCode: true,
        status: true,
        queueNumber: true,
        servicePrice: true,
        bookingMethod: { select: { code: true, name: true } },
        telehealthSession: { select: { id: true } },
        patientProfile: {
          select: {
            id: true,
            fullName: true,
            gender: true,
            dateOfBirth: true,
            nationalId: true,
            phoneNumber: true,
          },
        },
        servicePackage: {
          select: { id: true, name: true },
        },
        branch: {
          select: { id: true, name: true, address: true },
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
                room: { select: { id: true, code: true, name: true } },
                branch: { select: { id: true, name: true, address: true } },
                doctor: {
                  select: {
                    id: true,
                    academicRank: true,
                    user: { select: { fullName: true } },
                    specialties: {
                      select: {
                        specialty: { select: { name: true } },
                      },
                      take: 1,
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Không tìm thấy lịch hẹn');
    const isTelehealth = Boolean(row.telehealthSession || row.bookingMethod?.code === 'ONLINE_CONSULTATION');
    if (!(isTelehealth ? ['CONFIRMED', 'CHECKED_IN', 'IN_EXAMINATION', 'COMPLETED'] : ['CONFIRMED', 'CHECKED_IN']).includes(row.status)) throw new ConflictException('Lịch hẹn chưa được xác nhận');
    const doctorSlot = row.scheduleSlot;
    const room = doctorSlot?.schedule.room;
    const branch = doctorSlot?.schedule.branch ?? row.branch;
    if (!branch) throw new ConflictException('Không xác định được cơ sở khám');

    const rawToken = checkInToken(row.id, this.config.get<string>('auth.secret'));
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const appointmentDate = (doctorSlot?.schedule.workDate ? doctorSlot.schedule.workDate.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
    const expiresAt = new Date(`${appointmentDate}T23:59:59.999+07:00`);
    if (!isTelehealth) await this.prisma.appointmentQrToken.upsert({
      where: { appointmentId: row.id },
      update: { tokenHash, expiresAt },
      create: { appointmentId: row.id, tokenHash, expiresAt },
    });
    const estimatedQueueNumber = row.queueNumber;
    const doc = doctorSlot?.schedule?.doctor;
    const specialtyName = doc?.specialties?.[0]?.specialty?.name || (row.servicePackage ? 'Đa khoa / Gói khám' : 'Khám chuyên khoa');

    return {
      appointmentId: row.id,
      bookingCode: row.bookingCode,
      qrPayload: isTelehealth ? null : `VITACARE_CHECKIN:${rawToken}`,
      expiresAt,
      status: row.status,
      isTelehealth,
      bookingMethod: row.bookingMethod,
      queueNumber: isTelehealth ? null : row.queueNumber,
      estimatedQueueNumber: isTelehealth ? null : estimatedQueueNumber,
      appointmentDate,
      startTime: doctorSlot?.startTime ? doctorSlot.startTime.toISOString().slice(11, 16) : null,
      endTime: doctorSlot?.endTime ? doctorSlot.endTime.toISOString().slice(11, 16) : null,
      room: !isTelehealth && room ? { id: room.id, code: room.code, name: room.name } : null,
      branch: { id: branch.id, name: branch.name, address: branch.address },
      doctor: doc ? { id: doc.id, fullName: doc.user?.fullName ?? '', academicRank: doc.academicRank ?? null } : null,
      specialty: specialtyName,
      healthPackage: row.servicePackage ? { id: row.servicePackage.id, name: row.servicePackage.name } : null,
      patient: {
        id: row.patientProfile.id,
        fullName: row.patientProfile.fullName,
        gender: row.patientProfile.gender,
        dateOfBirth: row.patientProfile.dateOfBirth ? row.patientProfile.dateOfBirth.toISOString().slice(0, 10) : null,
        nationalId: row.patientProfile.nationalId || null,
        phoneNumber: row.patientProfile.phoneNumber || null,
      },
      totalAmount: Number(row.invoice?.totalAmount ?? row.servicePrice ?? 0),
      paymentStatus: row.invoice?.payments[0]?.status ?? (['CONFIRMED', 'CHECKED_IN'].includes(row.status) ? 'PAID' : null),
    };
  }
}
