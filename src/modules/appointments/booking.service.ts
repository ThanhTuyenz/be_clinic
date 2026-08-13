import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppointmentStatus, PaymentStatus, Prisma } from '@prisma/client';
import { createHash, createHmac } from 'crypto';
import { RabbitMqConfig } from '../../config/config.type.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { CheckoutAppointmentDto } from './dtos/checkout-appointment.dto.js';
import { PaymentWebhookDto } from './dtos/payment-webhook.dto.js';

const ACTIVE_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  'PENDING_PAYMENT', 'BOOKED', 'CHECKED_IN', 'IN_EXAMINATION',
];

@Injectable()
export class BookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private checkInToken(appointmentId: string) {
    const secret = this.config.get<string>('auth.secret');
    if (!secret) throw new Error('Thiếu AUTH_JWT_SECRET để phát hành QR check-in');
    return createHmac('sha256', secret).update(`check-in:${appointmentId}`).digest('base64url');
  }

  /**
   * Số dự kiến chỉ dành cho lịch đã thanh toán (BOOKED). Nó xếp các lịch đang
   * chờ check-in trong cùng slot sau bộ đếm số thật đã cấp. queueNumber vẫn chỉ
   * được ghi khi check-in.
   */
  private async estimatedQueueNumber(row: {
    id: string;
    status: AppointmentStatus;
    createdAt: Date;
    queueNumber: number | null;
    scheduleSlotId: string | null;
    servicePackageScheduleSlotId: string | null;
    scheduleSlot?: { nextQueueNumber: number } | null;
    servicePackageScheduleSlot?: { nextQueueNumber: number } | null;
  }) {
    if (row.queueNumber != null) return row.queueNumber;
    if (row.status !== 'BOOKED') return null;
    const slotFilter = row.servicePackageScheduleSlotId
      ? { servicePackageScheduleSlotId: row.servicePackageScheduleSlotId }
      : row.scheduleSlotId
        ? { scheduleSlotId: row.scheduleSlotId }
        : null;
    if (!slotFilter) return null;
    const bookedAheadOrSelf = await this.prisma.appointment.count({
      where: {
        ...slotFilter,
        status: 'BOOKED',
        queueNumber: null,
        OR: [
          { createdAt: { lt: row.createdAt } },
          { createdAt: row.createdAt, id: { lte: row.id } },
        ],
      },
    });
    const issuedCount = row.servicePackageScheduleSlot?.nextQueueNumber
      ?? row.scheduleSlot?.nextQueueNumber
      ?? 0;
    return issuedCount + bookedAheadOrSelf;
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
          const duplicate = await tx.appointment.findFirst({ where: { patientProfileId: profile.id, scheduleSlotId: doctorSlot.id, status: { in: ACTIVE_APPOINTMENT_STATUSES } } });
          if (duplicate) throw new ConflictException('Người bệnh đã có lịch hẹn trong khung giờ này');
          const reserved = await tx.$executeRaw`UPDATE "doctor_schedule_slots" SET "occupied_count" = "occupied_count" + 1, "updated_at" = NOW() WHERE "id" = ${doctorSlot.id}::uuid AND "is_active" = TRUE AND "occupied_count" < "capacity"`;
          if (reserved !== 1) throw new ConflictException('Bác sĩ vừa hết chỗ trong khung giờ này');
          const holdTtlMs = this.config.getOrThrow<RabbitMqConfig>('rabbitmq').holdTtlMs;
          const [{ now, expiresAt }] = await tx.$queryRaw<Array<{ now: Date; expiresAt: Date }>>`SELECT NOW() AS "now", NOW() + (${holdTtlMs} * INTERVAL '1 millisecond') AS "expiresAt"`;
          const price = doctorSlot.schedule.doctor.consultationFee;
          const appointment = await tx.appointment.create({ data: { patientProfileId: profile.id, doctorId: doctorSlot.schedule.doctorId, branchId: doctorSlot.schedule.branchId, scheduleSlotId: doctorSlot.id, servicePrice: price, symptomsDescription: dto.symptomsDescription, bookedViaAi: dto.bookedViaAi ?? false, holdExpiresAt: expiresAt, statusHistories: { create: { toStatus: 'PENDING_PAYMENT', actorId: accountId } } } });
          const invoice = await tx.invoice.create({ data: { appointmentId: appointment.id, issuedBranchId: doctorSlot.schedule.branchId, totalAmount: price, items: { create: { description: `Khám với ${doctorSlot.schedule.doctor.fullName}`, quantity: 1, unitPrice: price, amount: price } } } });
          const payment = await tx.paymentTransaction.create({ data: { invoiceId: invoice.id, provider: 'PENDING_SELECTION', idempotencyKey: `checkout:${appointment.id}`, method: 'ONLINE', amount: invoice.totalAmount } });
          await tx.outboxEvent.create({ data: { aggregateType: 'Appointment', aggregateId: appointment.id, eventType: 'appointment.hold.created', payload: { appointmentId: appointment.id, doctorSlotId: doctorSlot.id, holdExpiresAt: expiresAt.toISOString() } } });
          return { appointmentId: appointment.id, invoiceId: invoice.id, paymentId: payment.id, status: appointment.status, holdStartedAt: now, holdExpiresAt: expiresAt };
        }

        if (!dto.servicePackageId || !dto.servicePackageScheduleSlotId) throw new BadRequestException('Thiếu gói dịch vụ hoặc khung giờ của gói');

        const packageSlot = await tx.servicePackageScheduleSlot.findUnique({ where: { id: dto.servicePackageScheduleSlotId }, include: { schedule: { include: { room: true, servicePackage: { include: { branchBookingMethod: true } } } } } });
        const servicePackage = packageSlot?.schedule.servicePackage;
        if (!packageSlot || !servicePackage || servicePackage.id !== dto.servicePackageId || !packageSlot.isActive || !packageSlot.schedule.isActive || !servicePackage.isActive || !servicePackage.branchBookingMethod.isEnabled) throw new NotFoundException('Gói dịch vụ hoặc khung giờ không khả dụng');
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
            doctorId: doctorSlot?.schedule.doctorId,
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
    const estimatedQueueNumber = await this.estimatedQueueNumber(row);
    return {
      appointmentId: row.id, status: row.status, holdExpiresAt: row.holdExpiresAt,
      paymentStatus: row.invoice?.payments[0]?.status ?? null, hasQr: Boolean(row.qrToken),
      bookingCode: row.bookingCode,
      estimatedQueueNumber,
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
        doctor: true,
        servicePackage: true,
        branch: true,
        invoice: { include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } } },
        scheduleSlot: { include: { schedule: { include: { room: true, branch: true } } } },
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
        holdExpiresAt: row.holdExpiresAt,
        createdAt: row.createdAt,
        appointmentDate: (packageSlot?.schedule.examDate ?? doctorSlot?.schedule.workDate)?.toISOString().slice(0, 10) ?? null,
        startTime: (packageSlot?.startTime ?? doctorSlot?.startTime)?.toISOString().slice(11, 16) ?? null,
        endTime: (packageSlot?.endTime ?? doctorSlot?.endTime)?.toISOString().slice(11, 16) ?? null,
        patient: { id: row.patientProfile.id, fullName: row.patientProfile.fullName },
        doctor: row.doctor ? { id: row.doctor.id, fullName: row.doctor.fullName } : null,
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
        doctor: true,
        servicePackage: true,
        branch: true,
        scheduleSlot: { include: { schedule: { include: { room: true, branch: true } } } },
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
    const estimatedQueueNumber = await this.estimatedQueueNumber(row);
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
      doctor: row.doctor ? { id: row.doctor.id, fullName: row.doctor.fullName } : null,
      healthPackage: row.servicePackage ? { id: row.servicePackage.id, name: row.servicePackage.name } : null,
      patient: { id: row.patientProfile.id, fullName: row.patientProfile.fullName },
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
          doctor: true,
          servicePackage: true,
          scheduleSlot: { include: { schedule: { include: { room: true } } } },
          servicePackageScheduleSlot: { include: { schedule: { include: { room: true } } } },
        } } },
      });
      if (!qr || qr.expiresAt <= new Date()) throw new NotFoundException('QR không hợp lệ hoặc đã hết hạn');
      const alreadyCheckedIn = qr.appointment.status === 'CHECKED_IN';
      if (!alreadyCheckedIn && qr.appointment.status !== 'BOOKED') throw new ConflictException('APPOINTMENT_NOT_CHECKIN_READY');
      let assignedDoctorId = qr.appointment.doctorId;
      let assignedDoctorSlotId = qr.appointment.scheduleSlotId;
      const packageSlot = qr.appointment.servicePackageScheduleSlot;
      const specialtyId = qr.appointment.servicePackage?.specialtyId;
      if (!assignedDoctorId && packageSlot && specialtyId) {
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
            assignedDoctorId = candidate.schedule.doctorId;
            assignedDoctorSlotId = candidate.id;
            break;
          }
        }
        if (!assignedDoctorId) throw new ConflictException('Chưa có bác sĩ đúng chuyên khoa còn chỗ trong khung giờ này');
      }
      if (alreadyCheckedIn) {
        if (assignedDoctorId !== qr.appointment.doctorId || assignedDoctorSlotId !== qr.appointment.scheduleSlotId) {
          const repairedAppointment = await tx.appointment.update({
            where: { id: qr.appointment.id },
            data: { doctorId: assignedDoctorId, scheduleSlotId: assignedDoctorSlotId },
            include: { patientProfile: true, doctor: true, servicePackage: true, scheduleSlot: { include: { schedule: { include: { room: true } } } }, servicePackageScheduleSlot: { include: { schedule: { include: { room: true } } } } },
          });
          return this.checkInResult(repairedAppointment, channel);
        }
        return this.checkInResult(qr.appointment, channel);
      }
      const [counter] = qr.appointment.servicePackageScheduleSlotId
        ? await tx.$queryRaw<Array<{ nextQueueNumber: number }>>`
            UPDATE "service_package_schedule_slots"
            SET "next_queue_number" = "next_queue_number" + 1, "updated_at" = NOW()
            WHERE "id" = ${qr.appointment.servicePackageScheduleSlotId}::uuid
            RETURNING "next_queue_number" AS "nextQueueNumber"
          `
        : await tx.$queryRaw<Array<{ nextQueueNumber: number }>>`
            UPDATE "doctor_schedule_slots"
            SET "next_queue_number" = "next_queue_number" + 1, "updated_at" = NOW()
            WHERE "id" = ${qr.appointment.scheduleSlotId}::uuid
            RETURNING "next_queue_number" AS "nextQueueNumber"
          `;
      if (!counter) throw new ConflictException('Không tìm thấy khung giờ của lịch hẹn');
      const appointment = await tx.appointment.update({
        where: { id: qr.appointment.id },
        data: { status: 'CHECKED_IN', doctorId: assignedDoctorId, scheduleSlotId: assignedDoctorSlotId, queueNumber: counter.nextQueueNumber, checkedInAt: new Date(), checkedInById: actorId, statusHistories: { create: { fromStatus: 'BOOKED', toStatus: 'CHECKED_IN', actorId, reason: `CHECK_IN_${channel}` } } },
        include: { patientProfile: true, doctor: true, servicePackage: true, scheduleSlot: { include: { schedule: { include: { room: true } } } }, servicePackageScheduleSlot: { include: { schedule: { include: { room: true } } } } },
      });
      await tx.appointmentQrToken.update({ where: { id: qr.id }, data: { usedAt: new Date() } });
      return this.checkInResult(appointment, channel);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private checkInResult(appointment: any, channel: 'KIOSK' | 'RECEPTIONIST') {
    const room = appointment.servicePackageScheduleSlot?.schedule?.room ?? appointment.scheduleSlot?.schedule?.room;
    return { appointmentId: appointment.id, bookingCode: appointment.bookingCode, queueNumber: appointment.queueNumber, status: appointment.status, channel, checkedInAt: appointment.checkedInAt, patient: { fullName: appointment.patientProfile?.fullName }, doctor: appointment.doctor ? { fullName: appointment.doctor.fullName } : null, healthPackage: appointment.servicePackage ? { name: appointment.servicePackage.name } : null, room: room ? { code: room.code, name: room.name } : null };
  }

  private async confirmPaid(tx: Prisma.TransactionClient, paymentId: string, invoiceId: string, appointmentId: string, provider: string, dto: PaymentWebhookDto, late: boolean) {
    const rawToken = this.checkInToken(appointmentId);
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const bookingCode = `VC-${appointmentId.slice(0, 8).toUpperCase()}`;
    await tx.paymentTransaction.update({ where: { id: paymentId }, data: { provider, providerTransactionId: dto.providerTransactionId, status: late ? 'LATE_SUCCESS' : 'SUCCESS', paidAt: new Date(), rawPayload: dto.payload as Prisma.InputJsonValue } });
    await tx.invoice.update({ where: { id: invoiceId }, data: { status: 'PAID', paidAt: new Date() } });
    const appointment = await tx.appointment.update({ where: { id: appointmentId }, data: { status: 'BOOKED', bookingCode, holdExpiresAt: null, statusHistories: { create: { fromStatus: late ? 'EXPIRED' : 'PENDING_PAYMENT', toStatus: 'BOOKED', reason: late ? 'LATE_SUCCESS_CAPACITY_REACQUIRED' : 'PAYMENT_SUCCESS' } } } });
    await tx.appointmentQrToken.upsert({ where: { appointmentId }, update: { tokenHash, expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000), usedAt: null }, create: { appointmentId, tokenHash, expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000) } });
    await tx.outboxEvent.create({ data: { aggregateType: 'Appointment', aggregateId: appointmentId, eventType: 'appointment.booked', payload: { appointmentId, bookingCode, lateSuccess: late } } });
    return { status: late ? PaymentStatus.LATE_SUCCESS : PaymentStatus.SUCCESS, appointmentStatus: appointment.status, bookingCode, qrToken: rawToken };
  }
}
