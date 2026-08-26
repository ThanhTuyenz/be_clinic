import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppointmentStatus, PaymentStatus, Prisma } from '@prisma/client';
import { createHash, createHmac } from 'crypto';
import { RabbitMqConfig } from '../../config/config.type.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { MailsService } from '../mails/mails.service.js';
import { AppointmentItemDto, BatchCheckoutDto, CheckoutAppointmentDto } from './dtos/checkout-appointment.dto.js';
import { PaymentWebhookDto } from './dtos/payment-webhook.dto.js';

const ACTIVE_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  'PENDING_PAYMENT', 'BOOKED', 'CHECKED_IN',
];

@Injectable()
export class BookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mailsService: MailsService,
  ) {}


  public checkInToken(appointmentId: string) {
    const secret = this.config.get<string>('auth.secret');
    if (!secret) throw new Error('Thiếu AUTH_JWT_SECRET để phát hành QR check-in');
    return createHmac('sha256', secret).update(`check-in:${appointmentId}`).digest('base64url');
  }

  /**
   * Trả về số thứ tự cố định của lịch khám.
   */
  private estimatedQueueNumber(row: { queueNumber: number | null }) {
    return row.queueNumber;
  }

  private validateBookingLeadTime(examDate: Date) {
    const nowUtc = new Date();
    const vnOffsetMs = 7 * 60 * 60 * 1000;
    const nowVn = new Date(nowUtc.getTime() + vnOffsetMs);
    const currentHour = nowVn.getUTCHours();
    const currentMinute = nowVn.getUTCMinutes();

    const todayVnStr = nowVn.toISOString().slice(0, 10);
    const baseDate = new Date(`${todayVnStr}T00:00:00.000Z`);
    const examDateStr = examDate.toISOString().slice(0, 10);
    const examDateOnly = new Date(`${examDateStr}T00:00:00.000Z`);

    const diffDays = Math.round((examDateOnly.getTime() - baseDate.getTime()) / (24 * 60 * 60 * 1000));

    if (diffDays < 1) {
      throw new BadRequestException(
        'Hệ thống không nhận đặt lịch trực tuyến trong ngày. Để khám trong ngày hôm nay, quý khách vui lòng đến trực tiếp phòng khám để lấy số thứ tự tại quầy tiếp đón.',
      );
    }

    if (diffDays > 30) {
      throw new BadRequestException(
        'Hệ thống chỉ mở đặt lịch trực tuyến trước tối đa 30 ngày.',
      );
    }

    if (diffDays === 1) {
      const isPastCutoff = currentHour > 16 || (currentHour === 16 && currentMinute >= 30);
      if (isPastCutoff) {
        throw new BadRequestException(
          'Để khám vào ngày mai, quý khách vui lòng hoàn tất đặt lịch trước 16h30 hôm nay. Quý khách vui lòng chọn ngày khám khác hoặc đến lấy số trực tiếp tại quầy tiếp đón.',
        );
      }
    }
  }

  async checkout(accountId: string, dto: CheckoutAppointmentDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const profile = await tx.patientProfile.findFirst({
          where: { id: dto.patientProfileId, accountId },
        });
        if (!profile) throw new NotFoundException('Không tìm thấy hồ sơ bệnh nhân');

        if (dto.bookingType === 'DOCTOR') {
          if (!dto.scheduleSlotId) throw new BadRequestException('Thiếu khung giờ của bác sĩ');
          
          let doctorSlot: any = null;
          if (dto.scheduleSlotId.startsWith('virtual_')) {
            const parts = dto.scheduleSlotId.split('_');
            const scheduleId = parts[1];
            const startTimeStr = parts[2];
            const schedule = await tx.doctorSchedule.findUnique({ where: { id: scheduleId }, include: { doctor: true } });
            if (!schedule || schedule.status !== 'OPEN' || !schedule.doctor.isActive) throw new NotFoundException('Lịch làm việc của bác sĩ không khả dụng');

            const dateStr = schedule.workDate.toISOString().slice(0, 10);
            const startDt = new Date(`${dateStr}T${startTimeStr}:00.000Z`);
            const endDt = new Date(startDt.getTime() + (schedule.slotDurationMin || 30) * 60000);

            doctorSlot = await tx.doctorScheduleSlot.upsert({
              where: { scheduleId_startTime: { scheduleId, startTime: startDt } },
              update: {},
              create: { scheduleId, startTime: startDt, endTime: endDt, capacity: 1, occupiedCount: 0 },
              include: { schedule: { include: { doctor: true } } },
            });
          } else {
            doctorSlot = await tx.doctorScheduleSlot.findUnique({ where: { id: dto.scheduleSlotId }, include: { schedule: { include: { doctor: true } } } });
          }

          if (!doctorSlot || !doctorSlot.isActive || doctorSlot.schedule.status !== 'OPEN' || !doctorSlot.schedule.doctor.isActive) throw new NotFoundException('Khung giờ của bác sĩ không khả dụng');
          this.validateBookingLeadTime(doctorSlot.schedule.workDate);
          const duplicate = await tx.appointment.findFirst({ where: { patientProfileId: profile.id, scheduleSlotId: doctorSlot.id, status: { in: ACTIVE_APPOINTMENT_STATUSES } } });
          if (duplicate) throw new ConflictException('Người bệnh đã có lịch hẹn trong khung giờ này');
          const reserved = await tx.$executeRaw`UPDATE "doctor_schedule_slots" SET "occupied_count" = "occupied_count" + 1, "updated_at" = NOW() WHERE "id" = ${doctorSlot.id}::uuid AND "is_active" = TRUE AND "occupied_count" < "capacity"`;
          if (reserved !== 1) throw new ConflictException('Bác sĩ vừa hết chỗ trong khung giờ này');
          const holdTtlMs = this.config.getOrThrow<RabbitMqConfig>('rabbitmq').holdTtlMs;
          const [{ now, expiresAt }] = await tx.$queryRaw<Array<{ now: Date; expiresAt: Date }>>`SELECT NOW() AS "now", NOW() + (${holdTtlMs} * INTERVAL '1 millisecond') AS "expiresAt"`;
          const price = doctorSlot.schedule.doctor.consultationFee;
          const appointment = await tx.appointment.create({ data: { patientProfileId: profile.id, branchId: doctorSlot.schedule.branchId, scheduleSlotId: doctorSlot.id, servicePrice: price, symptomsDescription: dto.symptomsDescription, bookedViaAi: dto.bookedViaAi ?? false, holdExpiresAt: expiresAt, statusHistories: { create: { toStatus: 'PENDING_PAYMENT', actorId: accountId } } } });
          const invoice = await tx.invoice.create({ data: { appointmentId: appointment.id, issuedBranchId: doctorSlot.schedule.branchId, totalAmount: price, items: { create: { description: `Khám với ${doctorSlot.schedule.doctor.fullName}`, quantity: 1, unitPrice: price, amount: price } } } });
          const payment = await tx.paymentTransaction.create({ data: { invoiceId: invoice.id, provider: 'PENDING_SELECTION', idempotencyKey: `checkout:${appointment.id}`, method: 'ONLINE', amount: invoice.totalAmount } });
          await tx.outboxEvent.create({ data: { aggregateType: 'Appointment', aggregateId: appointment.id, eventType: 'appointment.hold.created', payload: { appointmentId: appointment.id, doctorSlotId: doctorSlot.id, holdExpiresAt: expiresAt.toISOString() } } });
          return { appointmentId: appointment.id, invoiceId: invoice.id, paymentId: payment.id, status: appointment.status, holdStartedAt: now, holdExpiresAt: expiresAt };
        }

        if (!dto.servicePackageId || !dto.servicePackageScheduleSlotId) throw new BadRequestException('Thiếu gói dịch vụ hoặc khung giờ của gói');

        const packageSlot = await tx.servicePackageScheduleSlot.findUnique({ where: { id: dto.servicePackageScheduleSlotId }, include: { schedule: { include: { room: true, servicePackage: { include: { branchBookingMethod: true } } } } } });
        const servicePackage = packageSlot?.schedule.servicePackage;
        if (!packageSlot || !servicePackage || servicePackage.id !== dto.servicePackageId || !packageSlot.isActive || !packageSlot.schedule.isActive || !servicePackage.isActive || !servicePackage.branchBookingMethod.isEnabled) throw new NotFoundException('Gói dịch vụ hoặc khung giờ không khả dụng');
        this.validateBookingLeadTime(packageSlot.schedule.examDate);
        if (!packageSlot.schedule.roomId) throw new ConflictException('Lịch khám chưa được phân phòng');
        if (packageSlot.schedule.room?.branchId !== servicePackage.branchBookingMethod.branchId) throw new ConflictException('Phòng khám không thuộc cơ sở của gói');
        if (servicePackage.specialtyId) {
          const compatibleRoom = await tx.clinicRoomSpecialty.count({ where: { roomId: packageSlot.schedule.roomId, specialtyId: servicePackage.specialtyId, isActive: true } });
          if (!compatibleRoom) throw new ConflictException('Phòng khám chưa được gán cho chuyên khoa của gói');
        }
        if (packageSlot.schedule.examDate < new Date(new Date().toISOString().slice(0, 10))) throw new BadRequestException('Ngày khám đã qua');

        const doctorSlot = dto.scheduleSlotId ? await tx.doctorScheduleSlot.findUnique({ where: { id: dto.scheduleSlotId }, include: { schedule: { include: { doctor: true } } } }) : null;
        if (dto.scheduleSlotId && (!doctorSlot || !doctorSlot.isActive || doctorSlot.schedule.status !== 'OPEN')) throw new NotFoundException('Khung giờ của bác sĩ không khả dụng');
        if (doctorSlot) {
          if (doctorSlot.schedule.branchId !== servicePackage.branchBookingMethod.branchId || doctorSlot.schedule.workDate.getTime() !== packageSlot.schedule.examDate.getTime() || doctorSlot.startTime.getTime() !== packageSlot.startTime.getTime()) throw new BadRequestException('Lịch bác sĩ không trùng với lịch của gói dịch vụ');
          if (servicePackage.specialtyId) {
            const compatible = await tx.doctorSpecialty.count({ where: { doctorId: doctorSlot.schedule.doctorId, specialtyId: servicePackage.specialtyId } });
            if (!compatible) throw new BadRequestException('Bác sĩ không thuộc chuyên khoa của gói dịch vụ');
          }
        }

        const duplicate = await tx.appointment.findFirst({
          where: { patientProfileId: profile.id, servicePackageScheduleSlotId: packageSlot.id, status: { in: ACTIVE_APPOINTMENT_STATUSES } },
        });
        if (duplicate) throw new ConflictException('Người bệnh đã có lịch hẹn trong khung giờ này');

        const packageReserved = await tx.$executeRaw`UPDATE "service_package_schedule_slots" SET "occupied_count" = "occupied_count" + 1, "updated_at" = NOW() WHERE "id" = ${packageSlot.id}::uuid AND "is_active" = TRUE AND "occupied_count" < "capacity"`;
        if (packageReserved !== 1) throw new ConflictException('Khung giờ của gói dịch vụ vừa hết chỗ');
        if (doctorSlot) {
          const doctorReserved = await tx.$executeRaw`UPDATE "doctor_schedule_slots" SET "occupied_count" = "occupied_count" + 1, "updated_at" = NOW() WHERE "id" = ${doctorSlot.id}::uuid AND "is_active" = TRUE AND "occupied_count" < "capacity"`;
          if (doctorReserved !== 1) throw new ConflictException('Bác sĩ vừa hết chỗ trong khung giờ này');
        }

        const holdTtlMs = this.config.getOrThrow<RabbitMqConfig>('rabbitmq').holdTtlMs;
        const [{ now, expiresAt }] = await tx.$queryRaw<Array<{ now: Date; expiresAt: Date }>>`
          SELECT
            NOW() AS "now",
            NOW() + (${holdTtlMs} * INTERVAL '1 millisecond') AS "expiresAt"
        `;
        const appointment = await tx.appointment.create({
          data: {
            patientProfileId: profile.id,
            branchId: servicePackage.branchBookingMethod.branchId,
            scheduleSlotId: doctorSlot?.id,
            servicePackageId: servicePackage.id,
            servicePackageScheduleSlotId: packageSlot.id,
            servicePrice: servicePackage.price,
            symptomsDescription: dto.symptomsDescription,
            bookedViaAi: dto.bookedViaAi ?? false,
            holdExpiresAt: expiresAt,
            statusHistories: { create: { toStatus: 'PENDING_PAYMENT', actorId: accountId } },
          },
        });
        const invoice = await tx.invoice.create({
          data: {
            appointmentId: appointment.id,
            issuedBranchId: servicePackage.branchBookingMethod.branchId,
            totalAmount: servicePackage.price,
            items: { create: { description: servicePackage.name, quantity: 1, unitPrice: servicePackage.price, amount: servicePackage.price } },
          },
        });
        const payment = await tx.paymentTransaction.create({
          data: {
            invoiceId: invoice.id,
            provider: 'PENDING_SELECTION',
            idempotencyKey: `checkout:${appointment.id}`,
            method: 'ONLINE',
            amount: invoice.totalAmount,
          },
        });
        await tx.outboxEvent.create({
          data: {
            aggregateType: 'Appointment', aggregateId: appointment.id,
            eventType: 'appointment.hold.created',
            payload: { appointmentId: appointment.id, servicePackageSlotId: packageSlot.id, doctorSlotId: doctorSlot?.id, holdExpiresAt: expiresAt.toISOString() },
          },
        });
        return { appointmentId: appointment.id, invoiceId: invoice.id, paymentId: payment.id, status: appointment.status, holdStartedAt: now, holdExpiresAt: expiresAt };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = String(error.meta?.target ?? '');
        if (target.includes('appointments_one_pending_payment_per_patient')) {
          throw new ConflictException(
            'Người bệnh đang có một lịch chờ thanh toán. Vui lòng hoàn tất thanh toán hoặc thử lại sau khi thời gian giữ chỗ kết thúc',
          );
        }
        if (target.includes('appointments_no_patient_slot_overlap')) {
          throw new ConflictException('Người bệnh đã có lịch hẹn trong khung giờ này');
        }
        throw new ConflictException('Không thể tạo thêm lịch hẹn do thông tin bị trùng');
      }
      throw error;
    }
  }

  async expireHold(appointmentId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.findUnique({ where: { id: appointmentId } });
      if (!appointment) return false;
      const changed = await tx.appointment.updateMany({
        where: { id: appointmentId, status: 'PENDING_PAYMENT', holdExpiresAt: { lte: new Date() } },
        data: { status: 'EXPIRED' },
      });
      if (changed.count !== 1) return false;
      if (appointment.servicePackageScheduleSlotId) {
        await tx.$executeRaw`
          UPDATE "service_package_schedule_slots"
          SET "occupied_count" = GREATEST("occupied_count" - 1, 0), "updated_at" = NOW()
          WHERE "id" = ${appointment.servicePackageScheduleSlotId}::uuid
        `;
      }
      if (appointment.scheduleSlotId) {
        await tx.$executeRaw`
          UPDATE "doctor_schedule_slots"
          SET "occupied_count" = GREATEST("occupied_count" - 1, 0), "updated_at" = NOW()
          WHERE "id" = ${appointment.scheduleSlotId}::uuid
        `;
      }
      await tx.paymentTransaction.updateMany({ where: { invoice: { appointmentId }, status: 'PENDING' }, data: { status: 'EXPIRED' } });
      await tx.appointmentStatusHistory.create({ data: { appointmentId, fromStatus: 'PENDING_PAYMENT', toStatus: 'EXPIRED', reason: 'PAYMENT_HOLD_TIMEOUT' } });
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async handlePaymentWebhook(provider: string, dto: PaymentWebhookDto) {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.paymentTransaction.findUnique({
        where: { id: dto.paymentId }, include: { invoice: { include: { appointment: true } } },
      });
      if (!payment) throw new NotFoundException('Không tìm thấy giao dịch');
      if (payment.providerTransactionId === dto.providerTransactionId && ['SUCCESS', 'LATE_SUCCESS', 'REFUND_REQUIRED', 'MANUAL_REVIEW'].includes(payment.status)) {
        return { status: payment.status, appointmentStatus: payment.invoice.appointment.status };
      }
      if (dto.status === 'FAILED') {
        await tx.paymentTransaction.update({ where: { id: payment.id }, data: { provider, providerTransactionId: dto.providerTransactionId, status: 'FAILED', rawPayload: dto.payload as Prisma.InputJsonValue } });
        return { status: PaymentStatus.FAILED, appointmentStatus: payment.invoice.appointment.status };
      }
      const appointment = payment.invoice.appointment;
      if (appointment.status === 'PENDING_PAYMENT' && appointment.holdExpiresAt && appointment.holdExpiresAt > new Date()) {
        return this.confirmPaid(tx, payment.id, payment.invoiceId, appointment.id, provider, dto, false);
      }
      if (appointment.status === 'EXPIRED') {
        const packageReserved = appointment.servicePackageScheduleSlotId ? await tx.$executeRaw`UPDATE "service_package_schedule_slots" SET "occupied_count" = "occupied_count" + 1, "updated_at" = NOW() WHERE "id" = ${appointment.servicePackageScheduleSlotId}::uuid AND "occupied_count" < "capacity" AND "is_active" = TRUE` : 1;
        const doctorReserved = packageReserved === 1 && appointment.scheduleSlotId ? await tx.$executeRaw`UPDATE "doctor_schedule_slots" SET "occupied_count" = "occupied_count" + 1, "updated_at" = NOW() WHERE "id" = ${appointment.scheduleSlotId}::uuid AND "occupied_count" < "capacity" AND "is_active" = TRUE` : appointment.scheduleSlotId ? 0 : 1;
        if (packageReserved === 1 && doctorReserved === 1) return this.confirmPaid(tx, payment.id, payment.invoiceId, appointment.id, provider, dto, true);
        if (packageReserved === 1) await tx.$executeRaw`UPDATE "service_package_schedule_slots" SET "occupied_count" = GREATEST("occupied_count" - 1, 0), "updated_at" = NOW() WHERE "id" = ${appointment.servicePackageScheduleSlotId}::uuid`;
        await tx.paymentTransaction.update({ where: { id: payment.id }, data: { provider, providerTransactionId: dto.providerTransactionId, status: 'REFUND_REQUIRED', paidAt: new Date(), rawPayload: dto.payload as Prisma.InputJsonValue } });
        await tx.appointment.update({ where: { id: appointment.id }, data: { status: 'REFUND_REQUIRED', statusHistories: { create: { fromStatus: 'EXPIRED', toStatus: 'REFUND_REQUIRED', reason: 'LATE_SUCCESS_SLOT_FULL' } } } });
        await tx.outboxEvent.create({ data: { aggregateType: 'PaymentTransaction', aggregateId: payment.id, eventType: 'payment.refund.required', payload: { paymentId: payment.id, appointmentId: appointment.id, reason: 'LATE_SUCCESS_SLOT_FULL' } } });
        return { status: PaymentStatus.REFUND_REQUIRED, appointmentStatus: AppointmentStatus.REFUND_REQUIRED };
      }
      return { status: payment.status, appointmentStatus: appointment.status };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async paymentStatus(appointmentId: string, accountId: string) {
    const row = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, patientProfile: { accountId } },
      include: {
        invoice: { include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } } },
        qrToken: true,
        scheduleSlot: { include: { schedule: { include: { room: true, branch: true } } } },
        servicePackageScheduleSlot: { include: { schedule: { include: { room: true, servicePackage: { include: { branchBookingMethod: { include: { branch: true } } } } } } } },
      },
    });
    if (!row) throw new NotFoundException('Không tìm thấy lịch hẹn');
    const doctorSlot = row.scheduleSlot;
    const packageSlot = row.servicePackageScheduleSlot;
    const room = doctorSlot?.schedule.room ?? packageSlot?.schedule.room;
    const branch = doctorSlot?.schedule.branch ?? packageSlot?.schedule.servicePackage.branchBookingMethod.branch;
    const estimatedQueueNumber = this.estimatedQueueNumber(row);
    return {
      appointmentId: row.id, status: row.status, holdExpiresAt: row.holdExpiresAt,
      paymentStatus: row.invoice?.payments[0]?.status ?? null, hasQr: Boolean(row.qrToken),
      bookingCode: row.bookingCode,
      queueNumber: row.queueNumber,
      estimatedQueueNumber: row.queueNumber ?? estimatedQueueNumber,
      room: room ? { id: room.id, code: room.code, name: room.name } : null,
      branch: branch ? { id: branch.id, name: branch.name, address: branch.address } : null,
    };
  }

  async myAppointments(accountId: string) {
    const rows = await this.prisma.appointment.findMany({
      where: { patientProfile: { accountId } },
      orderBy: { createdAt: 'desc' },
      include: {
        patientProfile: true,
        servicePackage: true,
        branch: true,
        invoice: { include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } } },
        scheduleSlot: { include: { schedule: { include: { doctor: { include: { user: true } }, room: true, branch: true } } } },
        servicePackageScheduleSlot: { include: { schedule: { include: { room: true } } } },
      },
    });
    return rows.map((row) => {
      const doctorSlot = row.scheduleSlot;
      const packageSlot = row.servicePackageScheduleSlot;
      const room = doctorSlot?.schedule.room ?? packageSlot?.schedule.room;
      const branch = doctorSlot?.schedule.branch ?? row.branch;
      return {
        id: row.id,
        bookingCode: row.bookingCode,
        status: row.status,
        queueNumber: row.queueNumber,
        holdExpiresAt: row.holdExpiresAt,
        createdAt: row.createdAt,
        appointmentDate: (packageSlot?.schedule.examDate ?? doctorSlot?.schedule.workDate)?.toISOString().slice(0, 10) ?? null,
        startTime: (packageSlot?.startTime ?? doctorSlot?.startTime)?.toISOString().slice(11, 16) ?? null,
        endTime: (packageSlot?.endTime ?? doctorSlot?.endTime)?.toISOString().slice(11, 16) ?? null,
        patient: { id: row.patientProfile.id, fullName: row.patientProfile.fullName },
        doctor: (() => { const d = doctorSlot?.schedule?.doctor; return d ? { id: d.id, fullName: d.user?.fullName ?? '' } : null; })(),
        service: row.servicePackage ? { id: row.servicePackage.id, name: row.servicePackage.name } : null,
        healthPackage: row.servicePackage ? { id: row.servicePackage.id, name: row.servicePackage.name } : null,
        branch: branch ? { id: branch.id, name: branch.name, address: branch.address } : null,
        room: room ? { id: room.id, code: room.code, name: room.name } : null,
        totalAmount: Number(row.invoice?.totalAmount ?? row.servicePrice ?? 0),
        invoiceStatus: row.invoice?.status ?? null,
        paymentStatus: row.invoice?.payments[0]?.status ?? null,
      };
    });
  }

  async issueCheckInPass(appointmentId: string, accountId: string) {
    const row = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, patientProfile: { accountId } },
      include: {
        patientProfile: true,
        servicePackage: true,
        branch: true,
        invoice: { include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } } },
        scheduleSlot: {
          include: {
            schedule: {
              include: {
                doctor: {
                  include: {
                    user: true,
                    specialties: { include: { specialty: true } },
                  },
                },
                room: true,
                branch: true,
              },
            },
          },
        },
        servicePackageScheduleSlot: { include: { schedule: { include: { room: true } } } },
      },
    });
    if (!row) throw new NotFoundException('Không tìm thấy lịch hẹn');
    if (!['BOOKED', 'CHECKED_IN'].includes(row.status)) throw new ConflictException('Lịch hẹn chưa sẵn sàng check-in');
    const doctorSlot = row.scheduleSlot;
    const packageSlot = row.servicePackageScheduleSlot;
    const room = doctorSlot?.schedule.room ?? packageSlot?.schedule.room;
    const branch = doctorSlot?.schedule.branch ?? row.branch;
    if (!branch) throw new ConflictException('Không xác định được cơ sở khám');

    const rawToken = this.checkInToken(row.id);
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const appointmentDate = (doctorSlot?.schedule.workDate ?? packageSlot!.schedule.examDate).toISOString().slice(0, 10);
    const expiresAt = new Date(`${appointmentDate}T23:59:59.999+07:00`);
    await this.prisma.appointmentQrToken.upsert({
      where: { appointmentId: row.id },
      update: { tokenHash, expiresAt, usedAt: row.status === 'CHECKED_IN' ? new Date() : null },
      create: { appointmentId: row.id, tokenHash, expiresAt },
    });
    const estimatedQueueNumber = this.estimatedQueueNumber(row);
    const doc = doctorSlot?.schedule?.doctor;
    const specialtyName = doc?.specialties?.[0]?.specialty?.name || (row.servicePackage ? 'Đa khoa / Gói khám' : 'Khám chuyên khoa');

    return {
      appointmentId: row.id,
      bookingCode: row.bookingCode,
      qrPayload: `VITACARE_CHECKIN:${rawToken}`,
      expiresAt,
      status: row.status,
      queueNumber: row.queueNumber,
      estimatedQueueNumber,
      appointmentDate,
      startTime: (doctorSlot?.startTime ?? packageSlot!.startTime).toISOString().slice(11, 16),
      endTime: (doctorSlot?.endTime ?? packageSlot!.endTime).toISOString().slice(11, 16),
      room: room ? { id: room.id, code: room.code, name: room.name } : null,
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
      paymentStatus: row.invoice?.payments[0]?.status ?? (['BOOKED', 'CHECKED_IN'].includes(row.status) ? 'PAID' : null),
    };
  }

  /**
   * Bệnh nhân tự hủy lịch hẹn đã đặt.
   * Xử lý giải phóng slot, hoàn tiền (REFUND_REQUIRED), ghi nhận lịch sử và gửi email.
   */
  async cancelMyAppointment(accountId: string, appointmentId: string, reason?: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        bookingOrder: true,
        patientProfile: { include: { account: { select: { email: true } } } },
        scheduleSlot: { include: { schedule: { include: { doctor: { include: { user: true } }, branch: true } } } },
        servicePackageScheduleSlot: { include: { schedule: { include: { servicePackage: true } } } },
        servicePackage: true,
        branch: true,
        invoice: { include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } } },
      },
    });

    if (!appointment) throw new NotFoundException('Không tìm thấy lịch hẹn');

    // Kiểm tra quyền sở hữu lịch hẹn
    const isOwner = appointment.bookingOrder?.accountId === accountId || appointment.patientProfile?.accountId === accountId;
    if (!isOwner) throw new ForbiddenException('Bạn không có quyền hủy lịch hẹn này');

    // Chỉ cho phép hủy khi đang ở trạng thái BOOKED hoặc PENDING_PAYMENT
    if (!['BOOKED', 'PENDING_PAYMENT'].includes(appointment.status)) {
      throw new BadRequestException(`Không thể hủy lịch hẹn đang ở trạng thái «${appointment.status}»`);
    }

    // Tính toán thời gian khám để kiểm tra tính cấp bách (sát giờ < 24h hoặc sau 16h30 ngày trước)
    const doctorSlot = appointment.scheduleSlot;
    const packageSlot = appointment.servicePackageScheduleSlot;
    const examDate = packageSlot?.schedule?.examDate ?? doctorSlot?.schedule?.workDate;
    const startTimeDate = packageSlot?.startTime ?? doctorSlot?.startTime;

    const now = new Date();
    let isUrgent = false;

    if (examDate && startTimeDate) {
      const examDateStr = examDate.toISOString().slice(0, 10);
      const startTimeStr = startTimeDate.toISOString().slice(11, 16);
      const appointmentDateTime = new Date(`${examDateStr}T${startTimeStr}:00+07:00`);

      const hoursUntilExam = (appointmentDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);

      // Nếu dưới 24h -> Coi là hủy gấp
      if (hoursUntilExam < 24) {
        isUrgent = true;
      }
    }

    const previousStatus = appointment.status;
    const latestPayment = appointment.invoice?.payments?.[0];
    const isPaid = latestPayment?.status === 'SUCCESS';

    await this.prisma.$transaction(async (tx) => {
      // 1. Cập nhật trạng thái Appointment -> CANCELLED
      await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          status: 'CANCELLED',
        },
      });

      // 2. Trả lại slot occupiedCount (giải phóng slot ngay lập tức)
      if (appointment.servicePackageScheduleSlotId) {
        await tx.$executeRaw`
          UPDATE "service_package_schedule_slots"
          SET "occupied_count" = GREATEST("occupied_count" - 1, 0), "updated_at" = NOW()
          WHERE "id" = ${appointment.servicePackageScheduleSlotId}::uuid
        `;
      }
      if (appointment.scheduleSlotId) {
        await tx.$executeRaw`
          UPDATE "doctor_schedule_slots"
          SET "occupied_count" = GREATEST("occupied_count" - 1, 0), "updated_at" = NOW()
          WHERE "id" = ${appointment.scheduleSlotId}::uuid
        `;
      }

      // 3. Nếu đã thanh toán trực tuyến thành công -> Tạo yêu cầu hoàn tiền
      if (isPaid && latestPayment) {
        await tx.paymentTransaction.update({
          where: { id: latestPayment.id },
          data: {
            status: 'REFUND_REQUIRED',
          },
        });

        if (appointment.invoice) {
          await tx.invoice.update({
            where: { id: appointment.invoice.id },
            data: { status: 'REFUNDED' },
          });
        }

        // Bắn Outbox event thông báo hoàn tiền
        await tx.outboxEvent.create({
          data: {
            aggregateType: 'PaymentTransaction',
            aggregateId: latestPayment.id,
            eventType: 'payment.refund.required',
            payload: {
              paymentId: latestPayment.id,
              appointmentId: appointment.id,
              bookingCode: appointment.bookingCode,
              amount: Number(latestPayment.amount),
              isUrgent,
              reason: reason || 'Bệnh nhân tự hủy lịch khám',
            },
          },
        });
      }

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
      const examDateStr = (packageSlot?.schedule?.examDate ?? doctorSlot?.schedule?.workDate)?.toISOString().slice(0, 10) ?? '';
      const startTimeStr = (packageSlot?.startTime ?? doctorSlot?.startTime)?.toISOString().slice(11, 16) ?? '';
      const doctorName = doctorSlot?.schedule?.doctor
        ? `${doctorSlot.schedule.doctor.academicRank ? doctorSlot.schedule.doctor.academicRank + ' ' : ''}${doctorSlot.schedule.doctor.user?.fullName ?? ''}`.trim()
        : null;
      const serviceName = packageSlot?.schedule?.servicePackage?.name || appointment.servicePackage?.name || null;
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
              ? (isUrgent
                ? 'Lịch hẹn được hủy sát giờ khám (<24h). Yêu cầu hoàn tiền đã được gửi tới Ban quản lý cơ sở để xét duyệt theo chính sách phòng khám.'
                : 'Yêu cầu hoàn tiền 100% đã được ghi nhận. Số tiền sẽ được hoàn về tài khoản MoMo / Ngân hàng của quý khách trong 1-3 ngày làm việc.')
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
      message: isUrgent
        ? 'Hủy lịch khám thành công. Do bạn hủy sát giờ khám (< 24 giờ), yêu cầu hoàn tiền sẽ được chuyển tới Quản lý phòng khám để xét duyệt theo chính sách.'
        : 'Hủy lịch khám thành công. Slot khám đã được giải phóng và yêu cầu hoàn tiền 100% đã được ghi nhận.',
    };
  }

  async checkIn(rawPayload: string, actorId: string | null, channel: 'KIOSK' | 'RECEPTIONIST') {

    const rawToken = String(rawPayload || '').trim().replace(/^VITACARE_CHECKIN:/, '');
    if (!rawToken) throw new BadRequestException('Thiếu mã QR check-in');
    if (channel === 'RECEPTIONIST') {
      const actor = await this.prisma.user.findUnique({ where: { id: actorId || '' }, select: { role: true } });
      if (!actor || !['ADMIN', 'BRANCH_MANAGER', 'RECEPTIONIST'].includes(actor.role)) throw new ForbiddenException('Không có quyền check-in bệnh nhân');
    }
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    return this.prisma.$transaction(async (tx) => {
      const qr = await tx.appointmentQrToken.findUnique({
        where: { tokenHash },
        include: { appointment: { include: {
          patientProfile: true,
          servicePackage: true,
          scheduleSlot: { include: { schedule: { include: { doctor: true, room: true } } } },
          servicePackageScheduleSlot: { include: { schedule: { include: { room: true } } } },
        } } },
      });
      if (!qr || qr.expiresAt <= new Date()) throw new NotFoundException('QR không hợp lệ hoặc đã hết hạn');
      const alreadyCheckedIn = qr.appointment.status === 'CHECKED_IN';
      if (!alreadyCheckedIn && qr.appointment.status !== 'BOOKED') throw new ConflictException('APPOINTMENT_NOT_CHECKIN_READY');
      let assignedDoctorSlotId = qr.appointment.scheduleSlotId;
      const packageSlot = qr.appointment.servicePackageScheduleSlot;
      const specialtyId = qr.appointment.servicePackage?.specialtyId;
      if (!assignedDoctorSlotId && packageSlot && specialtyId) {
        const candidates = await tx.doctorScheduleSlot.findMany({
          where: {
            isActive: true,
            startTime: packageSlot.startTime,
            occupiedCount: { lt: tx.doctorScheduleSlot.fields.capacity },
            schedule: {
              branchId: qr.appointment.branchId,
              workDate: packageSlot.schedule.examDate,
              status: 'OPEN',
              doctor: { isActive: true, specialties: { some: { specialtyId } } },
            },
          },
          include: { schedule: { include: { doctor: true } } },
          orderBy: [{ occupiedCount: 'asc' }, { createdAt: 'asc' }],
        });
        for (const candidate of candidates) {
          const reserved = await tx.doctorScheduleSlot.updateMany({
            where: { id: candidate.id, isActive: true, occupiedCount: { lt: candidate.capacity } },
            data: { occupiedCount: { increment: 1 } },
          });
          if (reserved.count === 1) {
            assignedDoctorSlotId = candidate.id;
            break;
          }
        }
        if (!assignedDoctorSlotId) throw new ConflictException('Chưa có bác sĩ đúng chuyên khoa còn chỗ trong khung giờ này');
      }
      if (alreadyCheckedIn) {
        if (assignedDoctorSlotId !== qr.appointment.scheduleSlotId) {
          const repairedAppointment = await tx.appointment.update({
            where: { id: qr.appointment.id },
            data: { scheduleSlotId: assignedDoctorSlotId },
            include: { patientProfile: true, servicePackage: true, scheduleSlot: { include: { schedule: { include: { doctor: true, room: true } } } }, servicePackageScheduleSlot: { include: { schedule: { include: { room: true } } } } },
          });
          return this.checkInResult(repairedAppointment, channel);
        }
        return this.checkInResult(qr.appointment, channel);
      }
      let finalQueueNumber = qr.appointment.queueNumber;
      if (finalQueueNumber == null) {
        finalQueueNumber = await this.computeQueueNumber(
          tx,
          qr.appointment.id,
          qr.appointment.scheduleSlotId,
          qr.appointment.servicePackageScheduleSlotId,
        );
      }

      const appointment = await tx.appointment.update({
        where: { id: qr.appointment.id },
        data: {
          status: 'CHECKED_IN',
          scheduleSlotId: assignedDoctorSlotId,
          queueNumber: finalQueueNumber,
          checkedInAt: new Date(),
          checkedInById: actorId,
          statusHistories: { create: { fromStatus: 'BOOKED', toStatus: 'CHECKED_IN', actorId, reason: `CHECK_IN_${channel}` } },
        },
        include: { patientProfile: true, servicePackage: true, scheduleSlot: { include: { schedule: { include: { doctor: true, room: true } } } }, servicePackageScheduleSlot: { include: { schedule: { include: { room: true } } } } },
      });
      await tx.appointmentQrToken.update({ where: { id: qr.id }, data: { usedAt: new Date() } });
      return this.checkInResult(appointment, channel);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private checkInResult(appointment: any, channel: 'KIOSK' | 'RECEPTIONIST') {
    const room = appointment.servicePackageScheduleSlot?.schedule?.room ?? appointment.scheduleSlot?.schedule?.room;
    const doctor = appointment.scheduleSlot?.schedule?.doctor;
    return { appointmentId: appointment.id, bookingCode: appointment.bookingCode, queueNumber: appointment.queueNumber, status: appointment.status, channel, checkedInAt: appointment.checkedInAt, patient: { fullName: appointment.patientProfile?.fullName }, doctor: doctor ? { fullName: doctor.fullName } : null, healthPackage: appointment.servicePackage ? { name: appointment.servicePackage.name } : null, room: room ? { code: room.code, name: room.name } : null };
  }

  // ─────────────────────────────────────────────────────────────
  // BATCH CHECKOUT – Đặt lịch nhóm All-or-Nothing
  // ─────────────────────────────────────────────────────────────
  /**
   * Đặt lịch cho nhiều thành viên cùng lúc trong 1 transaction.
   * Nếu bất kỳ slot nào hết chỗ → rollback toàn bộ.
   */
  async batchCheckout(accountId: string, dto: BatchCheckoutDto) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Danh sách thành viên không được rỗng');
    }
    const groupType = dto.groupType ?? (dto.items.length === 1 ? 'SINGLE' : 'FAMILY');

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Xác minh tất cả profiles thuộc account
        const profileIds = dto.items.map((i) => i.patientProfileId);
        const profiles = await tx.patientProfile.findMany({
          where: { id: { in: profileIds }, accountId },
          select: { id: true, fullName: true },
        });
        if (profiles.length !== dto.items.length) {
          throw new NotFoundException('Một hoặc nhiều hồ sơ bệnh nhân không hợp lệ');
        }

        const holdTtlMs = this.config.getOrThrow<RabbitMqConfig>('rabbitmq').holdTtlMs;
        const [{ now, expiresAt }] = await tx.$queryRaw<Array<{ now: Date; expiresAt: Date }>>`
          SELECT NOW() AS "now", NOW() + (${holdTtlMs} * INTERVAL '1 millisecond') AS "expiresAt"
        `;

        let totalAmount = new Prisma.Decimal(0);
        const appointmentData: any[] = [];
        const invoiceItems: any[] = [];

        // Khóa & validate từng slot một cách tuần tự (tránh deadlock)
        for (const item of dto.items) {
          const profile = profiles.find((p) => p.id === item.patientProfileId)!;

          if (item.bookingType === 'DOCTOR' || !item.servicePackageId) {
            // ── Đặt theo bác sĩ ──────────────────────────────────
            if (!item.scheduleSlotId) throw new BadRequestException(`Thiếu khung giờ bác sĩ cho ${profile.fullName}`);

            let doctorSlot: any;
            if (item.scheduleSlotId.startsWith('virtual_')) {
              const parts = item.scheduleSlotId.split('_');
              const scheduleId = parts[1];
              const startTimeStr = parts[2];
              const schedule = await (tx as any).doctorSchedule.findUnique({ where: { id: scheduleId }, include: { doctor: true } });
              if (!schedule || schedule.status !== 'OPEN' || !schedule.doctor.isActive) {
                throw new NotFoundException(`Lịch làm việc của bác sĩ không khả dụng cho ${profile.fullName}`);
              }
              const dateStr = schedule.workDate.toISOString().slice(0, 10);
              const startDt = new Date(`${dateStr}T${startTimeStr}:00.000Z`);
              const endDt = new Date(startDt.getTime() + schedule.slotDurationMin * 60_000);
              doctorSlot = await tx.doctorScheduleSlot.upsert({
                where: { scheduleId_startTime: { scheduleId, startTime: startDt } },
                update: {},
                create: { scheduleId, startTime: startDt, endTime: endDt, capacity: schedule.capacityPerSlot ?? 1, occupiedCount: 0 } as any,
                include: { schedule: { include: { doctor: true } } },
              });
            } else {
              doctorSlot = await tx.doctorScheduleSlot.findUnique({
                where: { id: item.scheduleSlotId },
                include: { schedule: { include: { doctor: true } } },
              });
            }
            if (!doctorSlot || !doctorSlot.isActive || doctorSlot.schedule.status !== 'OPEN') {
              throw new NotFoundException(`Khung giờ bác sĩ không khả dụng cho ${profile.fullName}`);
            }

            // Duplicate check
            const dup = await tx.appointment.findFirst({
              where: { patientProfileId: profile.id, scheduleSlotId: doctorSlot.id, status: { in: ACTIVE_APPOINTMENT_STATUSES } },
            });
            if (dup) throw new ConflictException(`${profile.fullName} đã có lịch hẹn trong khung giờ này`);

            // Atomic lock slot
            const reserved = await tx.$executeRaw`
              UPDATE "doctor_schedule_slots"
              SET "occupied_count" = "occupied_count" + 1, "updated_at" = NOW()
              WHERE "id" = ${doctorSlot.id}::uuid
                AND "is_active" = TRUE
                AND "occupied_count" < "capacity"
            `;
            if (reserved !== 1) throw new ConflictException(`Bác sĩ vừa hết chỗ trong khung giờ này (${profile.fullName})`);

            const price = doctorSlot.schedule.doctor.consultationFee;
            totalAmount = totalAmount.add(price);
            appointmentData.push({
              patientProfileId: profile.id,
              branchId: doctorSlot.schedule.branchId,
              scheduleSlotId: doctorSlot.id,
              servicePrice: price,
              symptomsDescription: item.symptomsDescription,
              bookedViaAi: item.bookedViaAi ?? false,
              holdExpiresAt: expiresAt,
            });
            invoiceItems.push({
              description: `Khám với ${doctorSlot.schedule.doctor.fullName} – ${profile.fullName}`,
              quantity: 1,
              unitPrice: price,
              amount: price,
            });
          } else {
            // ── Đặt theo gói dịch vụ ─────────────────────────────
            if (!item.servicePackageScheduleSlotId) {
              throw new BadRequestException(`Thiếu khung giờ gói dịch vụ cho ${profile.fullName}`);
            }
            const packageSlot = await tx.servicePackageScheduleSlot.findUnique({
              where: { id: item.servicePackageScheduleSlotId },
              include: { schedule: { include: { servicePackage: { include: { branchBookingMethod: true } } } } },
            });
            const pkg = packageSlot?.schedule.servicePackage;
            if (!packageSlot || !pkg || pkg.id !== item.servicePackageId || !packageSlot.isActive || !pkg.isActive) {
              throw new NotFoundException(`Gói dịch vụ không khả dụng cho ${profile.fullName}`);
            }

            const dup = await tx.appointment.findFirst({
              where: { patientProfileId: profile.id, servicePackageScheduleSlotId: packageSlot.id, status: { in: ACTIVE_APPOINTMENT_STATUSES } },
            });
            if (dup) throw new ConflictException(`${profile.fullName} đã có lịch hẹn trong khung giờ này`);

            const pkgReserved = await tx.$executeRaw`
              UPDATE "service_package_schedule_slots"
              SET "occupied_count" = "occupied_count" + 1, "updated_at" = NOW()
              WHERE "id" = ${packageSlot.id}::uuid
                AND "is_active" = TRUE
                AND "occupied_count" < "capacity"
            `;
            if (pkgReserved !== 1) throw new ConflictException(`Khung giờ gói dịch vụ hết chỗ (${profile.fullName})`);

            totalAmount = totalAmount.add(pkg.price);
            appointmentData.push({
              patientProfileId: profile.id,
              branchId: pkg.branchBookingMethod.branchId,
              servicePackageId: pkg.id,
              servicePackageScheduleSlotId: packageSlot.id,
              servicePrice: pkg.price,
              symptomsDescription: item.symptomsDescription,
              bookedViaAi: item.bookedViaAi ?? false,
              holdExpiresAt: expiresAt,
            });
            invoiceItems.push({
              description: `${pkg.name} – ${profile.fullName}`,
              quantity: 1,
              unitPrice: pkg.price,
              amount: pkg.price,
            });
          }
        }

        // Tạo BookingOrder tổng
        const orderCode = `ORD-${Date.now().toString(36).toUpperCase()}`;
        const branchId = appointmentData[0]?.branchId;
        const bookingOrder = await (tx as any).bookingOrder.create({
          data: {
            accountId,
            orderCode,
            groupType,
            totalAmount,
            note: dto.note,
          },
        });

        // Tạo tất cả Appointment
        const appointments = await Promise.all(
          appointmentData.map((appt) =>
            tx.appointment.create({
              data: {
                ...appt,
                bookingOrderId: bookingOrder.id,
                statusHistories: { create: { toStatus: 'PENDING_PAYMENT', actorId: accountId } },
              },
            }),
          ),
        );

        // 1 Invoice duy nhất cho toàn đơn
        const invoice = await tx.invoice.create({
          data: {
            bookingOrderId: bookingOrder.id,
            issuedBranchId: branchId,
            totalAmount,
            items: { create: invoiceItems },
          } as any,
        });

        const payment = await tx.paymentTransaction.create({
          data: {
            invoiceId: invoice.id,
            provider: 'PENDING_SELECTION',
            idempotencyKey: `checkout:${bookingOrder.id}`,
            method: 'ONLINE',
            amount: totalAmount,
          },
        });

        await tx.outboxEvent.create({
          data: {
            aggregateType: 'BookingOrder',
            aggregateId: bookingOrder.id,
            eventType: 'booking_order.hold.created',
            payload: { bookingOrderId: bookingOrder.id, appointmentIds: appointments.map((a) => a.id), holdExpiresAt: expiresAt.toISOString() },
          },
        });

        return {
          bookingOrderId: bookingOrder.id,
          orderCode,
          invoiceId: invoice.id,
          paymentId: payment.id,
          totalAmount: Number(totalAmount),
          groupType,
          holdStartedAt: now,
          holdExpiresAt: expiresAt,
          appointments: appointments.map((a) => ({ appointmentId: a.id, patientProfileId: a.patientProfileId, status: a.status })),
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Lịch hẹn bị trùng. Vui lòng chọn lại khung giờ');
      }
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // GỢI Ý KHUNG GIỜ SONG SONG / LIÊN TIẾP
  // ─────────────────────────────────────────────────────────────
  /**
   * Gợi ý xếp N thành viên vào cùng khung giờ (song song)
   * hoặc các khung giờ liên tiếp gần nhất.
   */
  async suggestParallelSlots(branchId: string, date: string, memberCount: number, specialtyId?: number) {
    if (!branchId || !date) throw new BadRequestException('Thiếu branchId hoặc date');
    if (memberCount < 1 || memberCount > 10) throw new BadRequestException('Số thành viên phải từ 1 đến 10');

    const workDate = (() => {
      const d = new Date(`${date}T00:00:00.000Z`);
      if (Number.isNaN(d.getTime())) throw new BadRequestException('Ngày không hợp lệ');
      return d;
    })();

    // Lấy tất cả slot còn chỗ trong ngày tại chi nhánh
    const slots = await this.prisma.doctorScheduleSlot.findMany({
      where: {
        isActive: true,
        slotStatus: 'AVAILABLE' as any,
        schedule: {
          branchId,
          workDate,
          status: 'OPEN',
          doctor: {
            isActive: true,
            ...(specialtyId ? { specialties: { some: { specialtyId } } } : {}),
          },
        },
      },
      include: {
        schedule: {
          include: {
            doctor: { select: { id: true, academicRank: true, consultationFee: true, user: { select: { fullName: true } } } },
          },
        },
      },
      orderBy: [{ startTime: 'asc' }, { occupiedCount: 'asc' }],
    });

    // Nhóm slot theo startTime
    const byTime = new Map<string, typeof slots>();
    for (const slot of slots) {
      if (slot.capacity - slot.occupiedCount < 1) continue;
      const key = slot.startTime.toISOString().slice(11, 16);
      if (!byTime.has(key)) byTime.set(key, []);
      byTime.get(key)!.push(slot);
    }

    // Tìm khung giờ có đủ N bác sĩ khác nhau cùng lúc
    const parallelOptions: any[] = [];
    for (const [time, slotsAtTime] of byTime.entries()) {
      if (slotsAtTime.length >= memberCount) {
        parallelOptions.push({
          type: 'PARALLEL',
          startTime: time,
          slots: slotsAtTime.slice(0, memberCount).map((s) => ({
            slotId: s.id,
            doctor: s.schedule.doctor ? { id: s.schedule.doctor.id, fullName: s.schedule.doctor.user?.fullName ?? '', academicRank: s.schedule.doctor.academicRank, consultationFee: s.schedule.doctor.consultationFee } : null,
            startTime: s.startTime.toISOString().slice(11, 16),
            endTime: s.endTime.toISOString().slice(11, 16),
            remainingCapacity: s.capacity - s.occupiedCount,
          })),
        });
      }
    }

    // Tìm dãy liên tiếp
    const sequentialOptions: any[] = [];
    const timeKeys = Array.from(byTime.keys()).sort();
    for (let i = 0; i <= timeKeys.length - memberCount; i++) {
      const candidate = timeKeys.slice(i, i + memberCount);
      const slotGroup = candidate.map((t) => byTime.get(t)![0]).filter(Boolean);
      if (slotGroup.length === memberCount) {
        sequentialOptions.push({
          type: 'SEQUENTIAL',
          startTime: candidate[0],
          endTime: candidate[candidate.length - 1],
          slots: slotGroup.map((s) => ({
            slotId: s.id,
            doctor: s.schedule.doctor ? { id: s.schedule.doctor.id, fullName: s.schedule.doctor.user?.fullName ?? '', academicRank: s.schedule.doctor.academicRank, consultationFee: s.schedule.doctor.consultationFee } : null,
            startTime: s.startTime.toISOString().slice(11, 16),
            endTime: s.endTime.toISOString().slice(11, 16),
            remainingCapacity: s.capacity - s.occupiedCount,
          })),
        });
      }
    }

    return {
      date,
      branchId,
      memberCount,
      parallelOptions: parallelOptions.slice(0, 5),
      sequentialOptions: sequentialOptions.slice(0, 5),
    };
  }

  private async computeQueueNumber(
    tx: Prisma.TransactionClient,
    appointmentId: string,
    scheduleSlotId?: string | null,
    servicePackageScheduleSlotId?: string | null,
  ): Promise<number> {
    if (servicePackageScheduleSlotId) {
      const currSlot = await tx.servicePackageScheduleSlot.findUnique({
        where: { id: servicePackageScheduleSlotId },
      });
      if (currSlot) {
        const earlierSlots = await tx.servicePackageScheduleSlot.findMany({
          where: {
            scheduleId: currSlot.scheduleId,
            isActive: true,
            startTime: { lt: currSlot.startTime },
          },
          select: { capacity: true },
        });
        const priorCapacity = earlierSlots.reduce((sum, s) => sum + (s.capacity || 1), 0);
        const bookedInCurrentSlot = await tx.appointment.count({
          where: {
            servicePackageScheduleSlotId: currSlot.id,
            queueNumber: { not: null },
            id: { not: appointmentId },
          },
        });
        return priorCapacity + bookedInCurrentSlot + 1;
      }
    }

    if (scheduleSlotId) {
      const currSlot = await tx.doctorScheduleSlot.findUnique({
        where: { id: scheduleSlotId },
      });
      if (currSlot) {
        const earlierSlots = await tx.doctorScheduleSlot.findMany({
          where: {
            scheduleId: currSlot.scheduleId,
            isActive: true,
            startTime: { lt: currSlot.startTime },
          },
          select: { capacity: true },
        });
        const priorCapacity = earlierSlots.reduce((sum, s) => sum + (s.capacity || 1), 0);
        const bookedInCurrentSlot = await tx.appointment.count({
          where: {
            scheduleSlotId: currSlot.id,
            queueNumber: { not: null },
            id: { not: appointmentId },
          },
        });
        return priorCapacity + bookedInCurrentSlot + 1;
      }
    }

    return 1;
  }

  private async confirmPaid(tx: Prisma.TransactionClient, paymentId: string, invoiceId: string, appointmentId: string, provider: string, dto: PaymentWebhookDto, late: boolean) {
    const rawToken = this.checkInToken(appointmentId);
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const bookingCode = `VC-${appointmentId.slice(0, 8).toUpperCase()}`;

    // Cấp số thứ tự cố định chuẩn theo thứ tự khung giờ trong ngày làm việc của Bác sĩ / Gói khám
    const existingAppt = await tx.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        scheduleSlot: true,
        servicePackageScheduleSlot: true,
      },
    });

    let assignedQueueNumber = existingAppt?.queueNumber ?? null;
    if (assignedQueueNumber == null && existingAppt) {
      assignedQueueNumber = await this.computeQueueNumber(
        tx,
        appointmentId,
        existingAppt.scheduleSlotId,
        existingAppt.servicePackageScheduleSlotId,
      );
    }

    await tx.paymentTransaction.update({ where: { id: paymentId }, data: { provider, providerTransactionId: dto.providerTransactionId, status: late ? 'LATE_SUCCESS' : 'SUCCESS', paidAt: new Date(), rawPayload: dto.payload as Prisma.InputJsonValue } });
    await tx.invoice.update({ where: { id: invoiceId }, data: { status: 'PAID', paidAt: new Date() } });
    const appointment = await tx.appointment.update({
      where: { id: appointmentId },
      data: {
        status: 'BOOKED',
        bookingCode,
        queueNumber: assignedQueueNumber,
        holdExpiresAt: null,
        statusHistories: { create: { fromStatus: late ? 'EXPIRED' : 'PENDING_PAYMENT', toStatus: 'BOOKED', reason: late ? 'LATE_SUCCESS_CAPACITY_REACQUIRED' : 'PAYMENT_SUCCESS' } },
      },
    });
    await tx.appointmentQrToken.upsert({ where: { appointmentId }, update: { tokenHash, expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000), usedAt: null }, create: { appointmentId, tokenHash, expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000) } });
    await tx.outboxEvent.create({ data: { aggregateType: 'Appointment', aggregateId: appointmentId, eventType: 'appointment.booked', payload: { appointmentId, bookingCode, queueNumber: assignedQueueNumber, lateSuccess: late } } });
    return { status: late ? PaymentStatus.LATE_SUCCESS : PaymentStatus.SUCCESS, appointmentStatus: appointment.status, bookingCode, queueNumber: assignedQueueNumber, qrToken: rawToken };
  }
}
