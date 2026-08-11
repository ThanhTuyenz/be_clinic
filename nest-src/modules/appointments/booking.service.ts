import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppointmentStatus, PaymentStatus, Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
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

  async checkout(accountId: string, dto: CheckoutAppointmentDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const profile = await tx.patientProfile.findFirst({
          where: { id: dto.patientProfileId, accountId },
        });
        if (!profile) throw new NotFoundException('Không tìm thấy hồ sơ bệnh nhân');

        if (dto.bookingType === 'HEALTH_PACKAGE') {
          if (!dto.healthPackageId || !dto.healthPackageScheduleSlotId) {
            throw new BadRequestException('Thiếu gói khám sức khỏe hoặc khung giờ khám');
          }
          const packageSlot = await tx.healthPackageScheduleSlot.findUnique({
            where: { id: dto.healthPackageScheduleSlotId },
            include: {
              schedule: {
                include: {
                  room: true,
                  healthPackage: { include: { branchBookingMethod: true } },
                },
              },
            },
          });
          const healthPackage = packageSlot?.schedule.healthPackage;
          if (
            !packageSlot || !healthPackage ||
            healthPackage.id !== dto.healthPackageId ||
            !packageSlot.isActive || !packageSlot.schedule.isActive ||
            !healthPackage.isActive || !healthPackage.branchBookingMethod.isEnabled
          ) {
            throw new NotFoundException('Gói khám hoặc khung giờ không khả dụng');
          }
          if (packageSlot.schedule.examDate < new Date(new Date().toISOString().slice(0, 10))) {
            throw new BadRequestException('Ngày khám đã qua');
          }
          const duplicate = await tx.appointment.findFirst({
            where: {
              patientProfileId: profile.id,
              healthPackageScheduleSlotId: packageSlot.id,
              status: { in: ACTIVE_APPOINTMENT_STATUSES },
            },
          });
          if (duplicate) throw new ConflictException('Người bệnh đã đăng ký gói trong khung giờ này');

          const reserved = await tx.$executeRaw`
            UPDATE "health_package_schedule_slots"
            SET "occupied_count" = "occupied_count" + 1, "updated_at" = NOW()
            WHERE "id" = ${packageSlot.id}::uuid
              AND "is_active" = TRUE
              AND "occupied_count" < "capacity"
          `;
          if (reserved !== 1) throw new ConflictException('Khung giờ này vừa hết chỗ');

          const holdTtlMs = this.config.getOrThrow<RabbitMqConfig>('rabbitmq').holdTtlMs;
          const [{ now, expiresAt }] = await tx.$queryRaw<Array<{ now: Date; expiresAt: Date }>>`
            SELECT NOW() AS "now", NOW() + (${holdTtlMs} * INTERVAL '1 millisecond') AS "expiresAt"
          `;
          const branchId = healthPackage.branchBookingMethod.branchId;
          const appointment = await tx.appointment.create({
            data: {
              patientProfileId: profile.id,
              branchId,
              healthPackageId: healthPackage.id,
              healthPackageScheduleSlotId: packageSlot.id,
              servicePrice: healthPackage.price,
              symptomsDescription: dto.symptomsDescription,
              bookedViaAi: dto.bookedViaAi ?? false,
              holdExpiresAt: expiresAt,
              statusHistories: { create: { toStatus: 'PENDING_PAYMENT', actorId: accountId } },
            },
          });
          const invoice = await tx.invoice.create({
            data: {
              appointmentId: appointment.id,
              issuedBranchId: branchId,
              totalAmount: healthPackage.price,
              items: { create: { description: healthPackage.name, quantity: 1, unitPrice: healthPackage.price, amount: healthPackage.price } },
            },
          });
          const payment = await tx.paymentTransaction.create({
            data: { invoiceId: invoice.id, provider: 'PENDING_SELECTION', idempotencyKey: `checkout:${appointment.id}`, method: 'ONLINE', amount: invoice.totalAmount },
          });
          await tx.outboxEvent.create({
            data: { aggregateType: 'Appointment', aggregateId: appointment.id, eventType: 'appointment.hold.created', payload: { appointmentId: appointment.id, healthPackageSlotId: packageSlot.id, holdExpiresAt: expiresAt.toISOString() } },
          });
          return { appointmentId: appointment.id, invoiceId: invoice.id, paymentId: payment.id, status: appointment.status, holdStartedAt: now, holdExpiresAt: expiresAt };
        }

        if (!dto.scheduleSlotId || !dto.specialtyServiceId) {
          throw new BadRequestException('Thiếu dịch vụ khám hoặc khung giờ bác sĩ');
        }

        const slot = await tx.doctorScheduleSlot.findUnique({
          where: { id: dto.scheduleSlotId },
          include: { schedule: { include: { doctor: true } } },
        });
        if (!slot || !slot.isActive || slot.schedule.status !== 'OPEN') {
          throw new NotFoundException('Khung giờ không khả dụng');
        }

        const specialtyService = await tx.specialtyService.findFirst({
          where: {
            id: dto.specialtyServiceId,
            isActive: true,
            branchBookingMethod: { branchId: slot.schedule.branchId, isEnabled: true, bookingMethod: { isActive: true } },
            specialty: { doctors: { some: { doctorId: slot.schedule.doctorId } } },
          },
        });
        if (!specialtyService) throw new BadRequestException('Dịch vụ khám không phù hợp với bác sĩ, chuyên khoa hoặc chi nhánh đã chọn');

        const duplicate = await tx.appointment.findFirst({
          where: {
            patientProfileId: profile.id,
            scheduleSlotId: slot.id,
            specialtyServiceId: specialtyService.id,
            servicePrice: specialtyService.price,
            status: { in: ACTIVE_APPOINTMENT_STATUSES },
          },
        });
        if (duplicate) {
          throw new ConflictException('Người bệnh đã có lịch hẹn trong khung giờ này');
        }

        const reserved = await tx.$executeRaw`
          UPDATE "doctor_schedule_slots"
          SET "occupied_count" = "occupied_count" + 1,
              "updated_at" = NOW()
          WHERE "id" = ${slot.id}::uuid
            AND "is_active" = TRUE
            AND "occupied_count" < "capacity"
        `;
        if (reserved !== 1) throw new ConflictException('Khung giờ này vừa hết chỗ');

        const holdTtlMs = this.config.getOrThrow<RabbitMqConfig>('rabbitmq').holdTtlMs;
        const [{ now, expiresAt }] = await tx.$queryRaw<Array<{ now: Date; expiresAt: Date }>>`
          SELECT
            NOW() AS "now",
            NOW() + (${holdTtlMs} * INTERVAL '1 millisecond') AS "expiresAt"
        `;
        const appointment = await tx.appointment.create({
          data: {
            patientProfileId: profile.id,
            doctorId: slot.schedule.doctorId,
            branchId: slot.schedule.branchId,
            scheduleSlotId: slot.id,
            specialtyServiceId: specialtyService.id,
            servicePrice: specialtyService.price,
            symptomsDescription: dto.symptomsDescription,
            bookedViaAi: dto.bookedViaAi ?? false,
            holdExpiresAt: expiresAt,
            statusHistories: { create: { toStatus: 'PENDING_PAYMENT', actorId: accountId } },
          },
        });
        const invoice = await tx.invoice.create({
          data: {
            appointmentId: appointment.id,
            issuedBranchId: slot.schedule.branchId,
            totalAmount: specialtyService.price,
            items: { create: { description: specialtyService.name, quantity: 1, unitPrice: specialtyService.price, amount: specialtyService.price } },
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
            payload: { appointmentId: appointment.id, slotId: slot.id, holdExpiresAt: expiresAt.toISOString() },
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
      if (appointment.healthPackageScheduleSlotId) {
        await tx.$executeRaw`
          UPDATE "health_package_schedule_slots"
          SET "occupied_count" = GREATEST("occupied_count" - 1, 0), "updated_at" = NOW()
          WHERE "id" = ${appointment.healthPackageScheduleSlotId}::uuid
        `;
      } else if (appointment.scheduleSlotId) {
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
        const reserved = appointment.healthPackageScheduleSlotId
          ? await tx.$executeRaw`
              UPDATE "health_package_schedule_slots" SET "occupied_count" = "occupied_count" + 1, "updated_at" = NOW()
              WHERE "id" = ${appointment.healthPackageScheduleSlotId}::uuid AND "occupied_count" < "capacity" AND "is_active" = TRUE
            `
          : appointment.scheduleSlotId
            ? await tx.$executeRaw`
                UPDATE "doctor_schedule_slots" SET "occupied_count" = "occupied_count" + 1, "updated_at" = NOW()
                WHERE "id" = ${appointment.scheduleSlotId}::uuid AND "occupied_count" < "capacity" AND "is_active" = TRUE
              `
            : 0;
        if (reserved === 1) return this.confirmPaid(tx, payment.id, payment.invoiceId, appointment.id, provider, dto, true);
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
        healthPackageScheduleSlot: { include: { schedule: { include: { room: true, healthPackage: { include: { branchBookingMethod: { include: { branch: true } } } } } } } },
      },
    });
    if (!row) throw new NotFoundException('Không tìm thấy lịch hẹn');
    const doctorSlot = row.scheduleSlot;
    const packageSlot = row.healthPackageScheduleSlot;
    const room = doctorSlot?.schedule.room ?? packageSlot?.schedule.room;
    const branch = doctorSlot?.schedule.branch ?? packageSlot?.schedule.healthPackage.branchBookingMethod.branch;
    return {
      appointmentId: row.id, status: row.status, holdExpiresAt: row.holdExpiresAt,
      paymentStatus: row.invoice?.payments[0]?.status ?? null, hasQr: Boolean(row.qrToken),
      bookingCode: row.bookingCode,
      estimatedQueueNumber: row.queueNumber ?? (doctorSlot ? doctorSlot.nextQueueNumber + 1 : packageSlot ? packageSlot.nextQueueNumber + 1 : null),
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
        specialtyService: true,
        healthPackage: true,
        invoice: { include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } } },
        scheduleSlot: { include: { schedule: { include: { room: true, branch: true } } } },
        healthPackageScheduleSlot: { include: { schedule: { include: { room: true, healthPackage: { include: { branchBookingMethod: { include: { branch: true } } } } } } } },
      },
    });
    return rows.map((row) => {
      const doctorSlot = row.scheduleSlot;
      const packageSlot = row.healthPackageScheduleSlot;
      const room = doctorSlot?.schedule.room ?? packageSlot?.schedule.room;
      const branch = doctorSlot?.schedule.branch ?? packageSlot?.schedule.healthPackage.branchBookingMethod.branch;
      return {
        id: row.id,
        bookingCode: row.bookingCode,
        status: row.status,
        holdExpiresAt: row.holdExpiresAt,
        createdAt: row.createdAt,
        appointmentDate: (doctorSlot?.schedule.workDate ?? packageSlot?.schedule.examDate)?.toISOString().slice(0, 10) ?? null,
        startTime: (doctorSlot?.startTime ?? packageSlot?.startTime)?.toISOString().slice(11, 16) ?? null,
        endTime: (doctorSlot?.endTime ?? packageSlot?.endTime)?.toISOString().slice(11, 16) ?? null,
        patient: { id: row.patientProfile.id, fullName: row.patientProfile.fullName },
        doctor: row.doctor ? { id: row.doctor.id, fullName: row.doctor.fullName } : null,
        service: row.specialtyService ? { id: row.specialtyService.id, name: row.specialtyService.name } : null,
        healthPackage: row.healthPackage ? { id: row.healthPackage.id, name: row.healthPackage.name } : null,
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
        healthPackage: true,
        scheduleSlot: { include: { schedule: { include: { room: true, branch: true } } } },
        healthPackageScheduleSlot: { include: { schedule: { include: { room: true, healthPackage: { include: { branchBookingMethod: { include: { branch: true } } } } } } } },
      },
    });
    if (!row) throw new NotFoundException('Không tìm thấy lịch hẹn');
    if (!['BOOKED', 'CHECKED_IN'].includes(row.status)) throw new ConflictException('Lịch hẹn chưa sẵn sàng check-in');
    const doctorSlot = row.scheduleSlot;
    const packageSlot = row.healthPackageScheduleSlot;
    const room = doctorSlot?.schedule.room ?? packageSlot?.schedule.room;
    const branch = doctorSlot?.schedule.branch ?? packageSlot?.schedule.healthPackage.branchBookingMethod.branch;
    if (!room || !branch) throw new ConflictException('Ca khám chưa được phân phòng');

    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const appointmentDate = (doctorSlot?.schedule.workDate ?? packageSlot!.schedule.examDate).toISOString().slice(0, 10);
    const expiresAt = new Date(`${appointmentDate}T23:59:59.999+07:00`);
    await this.prisma.appointmentQrToken.upsert({
      where: { appointmentId: row.id },
      update: { tokenHash, expiresAt, usedAt: row.status === 'CHECKED_IN' ? new Date() : null },
      create: { appointmentId: row.id, tokenHash, expiresAt },
    });
    return {
      appointmentId: row.id,
      bookingCode: row.bookingCode,
      qrPayload: `VITACARE_CHECKIN:${rawToken}`,
      expiresAt,
      status: row.status,
      queueNumber: row.queueNumber,
      estimatedQueueNumber: row.queueNumber ?? (doctorSlot ? doctorSlot.nextQueueNumber + 1 : packageSlot ? packageSlot.nextQueueNumber + 1 : null),
      appointmentDate,
      startTime: (doctorSlot?.startTime ?? packageSlot!.startTime).toISOString().slice(11, 16),
      endTime: (doctorSlot?.endTime ?? packageSlot!.endTime).toISOString().slice(11, 16),
      room: { id: room.id, code: room.code, name: room.name },
      branch: { id: branch.id, name: branch.name, address: branch.address },
      doctor: row.doctor ? { id: row.doctor.id, fullName: row.doctor.fullName } : null,
      healthPackage: row.healthPackage ? { id: row.healthPackage.id, name: row.healthPackage.name } : null,
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
          healthPackage: true,
          scheduleSlot: { include: { schedule: { include: { room: true } } } },
          healthPackageScheduleSlot: { include: { schedule: { include: { room: true } } } },
        } } },
      });
      if (!qr || qr.expiresAt <= new Date()) throw new NotFoundException('QR không hợp lệ hoặc đã hết hạn');
      if (qr.appointment.status === 'CHECKED_IN') return this.checkInResult(qr.appointment, channel);
      if (qr.appointment.status !== 'BOOKED') throw new ConflictException('APPOINTMENT_NOT_CHECKIN_READY');
      const [counter] = qr.appointment.healthPackageScheduleSlotId
        ? await tx.$queryRaw<Array<{ nextQueueNumber: number }>>`
            UPDATE "health_package_schedule_slots"
            SET "next_queue_number" = "next_queue_number" + 1, "updated_at" = NOW()
            WHERE "id" = ${qr.appointment.healthPackageScheduleSlotId}::uuid
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
        data: { status: 'CHECKED_IN', queueNumber: counter.nextQueueNumber, checkedInAt: new Date(), checkedInById: actorId, statusHistories: { create: { fromStatus: 'BOOKED', toStatus: 'CHECKED_IN', actorId, reason: `CHECK_IN_${channel}` } } },
        include: { patientProfile: true, doctor: true, healthPackage: true, scheduleSlot: { include: { schedule: { include: { room: true } } } }, healthPackageScheduleSlot: { include: { schedule: { include: { room: true } } } } },
      });
      await tx.appointmentQrToken.update({ where: { id: qr.id }, data: { usedAt: new Date() } });
      return this.checkInResult(appointment, channel);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private checkInResult(appointment: any, channel: 'KIOSK' | 'RECEPTIONIST') {
    const room = appointment.scheduleSlot?.schedule?.room ?? appointment.healthPackageScheduleSlot?.schedule?.room;
    return { appointmentId: appointment.id, bookingCode: appointment.bookingCode, queueNumber: appointment.queueNumber, status: appointment.status, channel, checkedInAt: appointment.checkedInAt, patient: { fullName: appointment.patientProfile?.fullName }, doctor: appointment.doctor ? { fullName: appointment.doctor.fullName } : null, healthPackage: appointment.healthPackage ? { name: appointment.healthPackage.name } : null, room: room ? { code: room.code, name: room.name } : null };
  }

  private async confirmPaid(tx: Prisma.TransactionClient, paymentId: string, invoiceId: string, appointmentId: string, provider: string, dto: PaymentWebhookDto, late: boolean) {
    const rawToken = randomBytes(32).toString('base64url');
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
