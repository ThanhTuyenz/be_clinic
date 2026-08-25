import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import QRCode from 'qrcode';
import { PrismaService } from '../../database/prisma/prisma.service.js';
import { BookingService } from '../../../modules/appointments/booking.service.js';
import { MailsService } from '../../../modules/mails/mails.service.js';
import { RabbitMqConfig } from '../../../config/config.type.js';
import { RABBITMQ_TOPOLOGY as topology } from './rabbitmq.constants.js';

@Injectable()
export class RabbitMqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqService.name);
  private connection: any;
  private channel: any;
  private publisherTimer?: NodeJS.Timeout;
  private reconciliationTimer?: NodeJS.Timeout;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly bookingService: BookingService,
    private readonly mailsService: MailsService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.reconciliationTimer = setInterval(() => void this.reconcileExpiredHolds(), 60_000);
    this.reconciliationTimer.unref();
    const rabbit = this.rabbitConfig();
    if (!rabbit.enabled) {
      this.logger.warn('RabbitMQ disabled; reconciliation must expire holds until enabled');
      return;
    }
    if (!rabbit.url) throw new Error('RABBITMQ_URL is required when RabbitMQ is enabled');
    this.connection = await amqp.connect(rabbit.url);
    this.channel = await this.connection.createConfirmChannel();
    await this.declareTopology();
    await this.consumeExpiredHolds();
    await this.consumeBookedAppointments();
    this.publisherTimer = setInterval(() => void this.publishOutboxBatch(), rabbit.outboxPollMs);
    this.publisherTimer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.publisherTimer) clearInterval(this.publisherTimer);
    if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
    await this.channel?.close();
    await this.connection?.close();
  }

  private async declareTopology(): Promise<void> {
    await this.channel.assertExchange(topology.holdExchange, 'direct', { durable: true });
    await this.channel.assertExchange(topology.expiredExchange, 'direct', { durable: true });
    await this.channel.assertExchange(topology.retryExchange, 'direct', { durable: true });
    await this.channel.assertExchange(topology.eventsExchange, 'topic', { durable: true });

    // Hold wait queue
    await this.channel.assertQueue(topology.holdWaitQueue, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': topology.expiredExchange,
        'x-dead-letter-routing-key': topology.expiredRoutingKey,
      },
    });
    await this.channel.bindQueue(topology.holdWaitQueue, topology.holdExchange, topology.holdRoutingKey);

    // Expired queue
    await this.channel.assertQueue(topology.expiredQueue, {
      durable: true,
      arguments: { 'x-dead-letter-exchange': topology.retryExchange, 'x-dead-letter-routing-key': topology.failedRoutingKey },
    });
    await this.channel.bindQueue(topology.expiredQueue, topology.expiredExchange, topology.expiredRoutingKey);

    // DLQ
    await this.channel.assertQueue(topology.deadLetterQueue, { durable: true });
    await this.channel.bindQueue(topology.deadLetterQueue, topology.retryExchange, topology.failedRoutingKey);

    // Booked appointment email queue
    await this.channel.assertQueue(topology.bookedQueue, { durable: true });
    await this.channel.bindQueue(topology.bookedQueue, topology.eventsExchange, topology.bookedRoutingKey);

    await this.channel.prefetch(this.rabbitConfig().prefetch);
  }

  private async publishOutboxBatch(): Promise<void> {
    if (!this.channel) return;
    const events = await this.prisma.outboxEvent.findMany({
      where: { status: 'PENDING', availableAt: { lte: new Date() } },
      orderBy: { createdAt: 'asc' }, take: this.rabbitConfig().outboxBatchSize,
    });
    for (const event of events) {
      try {
        const isHold = event.eventType === 'appointment.hold.created';
        const payload = event.payload as { holdExpiresAt?: string };
        const expiration = isHold
          ? String(Math.max(1, new Date(payload.holdExpiresAt ?? 0).getTime() - Date.now()))
          : undefined;
        this.channel.publish(
          isHold ? topology.holdExchange : topology.eventsExchange,
          isHold ? topology.holdRoutingKey : event.eventType,
          Buffer.from(JSON.stringify({ eventId: event.id, ...event.payload as object })),
          { persistent: true, messageId: event.id, contentType: 'application/json', expiration },
        );
        await this.channel.waitForConfirms();
        await this.prisma.outboxEvent.update({ where: { id: event.id }, data: { status: 'PUBLISHED', publishedAt: new Date(), attempts: { increment: 1 } } });
      } catch (error) {
        await this.prisma.outboxEvent.update({ where: { id: event.id }, data: { attempts: { increment: 1 }, lastError: error instanceof Error ? error.message : String(error) } });
      }
    }
  }

  private async consumeExpiredHolds(): Promise<void> {
    await this.channel.consume(topology.expiredQueue, async (message: any) => {
      if (!message) return;
      try {
        const payload = JSON.parse(message.content.toString()) as { eventId: string; appointmentId: string };
        const processed = await this.prisma.processedEvent.findUnique({ where: { eventId: payload.eventId } });
        if (!processed) {
          await this.bookingService.expireHold(payload.appointmentId);
          await this.prisma.processedEvent.create({ data: { eventId: payload.eventId, consumer: 'appointment-expiration' } });
        }
        this.channel.ack(message);
      } catch (error) {
        this.logger.error('Unable to expire appointment hold', error);
        this.channel.nack(message, false, false);
      }
    }, { noAck: false });
  }

  private async consumeBookedAppointments(): Promise<void> {
    await this.channel.consume(topology.bookedQueue, async (message: any) => {
      if (!message) return;
      try {
        const payload = JSON.parse(message.content.toString()) as {
          eventId: string;
          appointmentId: string;
          bookingCode?: string;
          queueNumber?: number;
        };
        const processed = await this.prisma.processedEvent.findUnique({ where: { eventId: payload.eventId } });
        if (!processed) {
          await this.sendBookingConfirmationEmail(payload.appointmentId);
          await this.prisma.processedEvent.create({
            data: { eventId: payload.eventId, consumer: 'appointment-booked-mail' },
          });
        }
        this.channel.ack(message);
      } catch (error) {
        this.logger.error('Unable to process booked appointment email notification', error);
        this.channel.nack(message, false, false);
      }
    }, { noAck: false });
  }

  private async sendBookingConfirmationEmail(appointmentId: string): Promise<void> {
    const appt = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        patientProfile: {
          include: {
            account: { select: { email: true, phoneNumber: true } },
          },
        },
        scheduleSlot: {
          include: {
            schedule: {
              include: {
                doctor: { select: { academicRank: true, user: { select: { fullName: true } } } },
                room: { select: { name: true } },
                branch: { select: { name: true, address: true, phoneNumber: true } },
              },
            },
          },
        },
        servicePackageScheduleSlot: {
          include: {
            schedule: {
              include: {
                servicePackage: {
                  include: {
                    branchBookingMethod: {
                      include: {
                        branch: { select: { name: true, address: true, phoneNumber: true } },
                      },
                    },
                  },
                },
                room: { select: { name: true } },
              },
            },
          },
        },
        invoice: { select: { totalAmount: true } },
        branch: { select: { name: true, address: true, phoneNumber: true } },
      },
    });

    if (!appt) {
      this.logger.warn(`Appointment not found for confirmation email: ${appointmentId}`);
      return;
    }

    const email = appt.patientProfile.account?.email;
    if (!email) {
      this.logger.log(`No email found for patient in appointment ${appointmentId}`);
      return;
    }

    const doctorSlot = appt.scheduleSlot;
    const packageSlot = appt.servicePackageScheduleSlot;
    const branch = doctorSlot?.schedule.branch ?? packageSlot?.schedule.servicePackage.branchBookingMethod.branch ?? appt.branch;
    const room = doctorSlot?.schedule.room ?? packageSlot?.schedule.room;

    const appointmentDate =
      doctorSlot?.schedule.workDate?.toISOString().slice(0, 10) ??
      packageSlot?.schedule.examDate?.toISOString().slice(0, 10) ??
      new Date().toISOString().slice(0, 10);

    const startTime =
      doctorSlot?.startTime?.toISOString().slice(11, 16) ??
      packageSlot?.startTime?.toISOString().slice(11, 16) ??
      '';

    const doctorName = doctorSlot?.schedule.doctor
      ? `${doctorSlot.schedule.doctor.academicRank ? doctorSlot.schedule.doctor.academicRank + ' ' : ''}${doctorSlot.schedule.doctor.user?.fullName ?? ''}`.trim()
      : null;

    const servicePackageName = packageSlot?.schedule.servicePackage?.name ?? null;

    // Sinh mã QR Code base64 Data URL (dùng chung định dạng VITACARE_CHECKIN với Web & Kiosk/Lễ tân)
    let qrCodeDataUrl: string | null = null;
    try {
      const rawToken = this.bookingService.checkInToken(appt.id);
      const qrPayload = `VITACARE_CHECKIN:${rawToken}`;
      qrCodeDataUrl = await QRCode.toDataURL(qrPayload, {
        width: 250,
        margin: 2,
        color: {
          dark: '#0f172a',
          light: '#ffffff',
        },
      });
    } catch (qrErr) {
      this.logger.warn(`Failed to generate QR code data URL for appointment ${appointmentId}`, qrErr);
    }

    await this.mailsService.sendBookingConfirmation({
      to: email,
      data: {
        patientName: appt.patientProfile.fullName,
        patientCode: appt.patientProfile.patientCode,
        bookingCode: appt.bookingCode ?? appt.id,
        queueNumber: appt.queueNumber,
        appointmentDate,
        startTime,
        branchName: branch?.name ?? 'VitaCare Clinic',
        branchAddress: branch?.address ?? '',
        branchPhone: branch?.phoneNumber ?? '',
        doctorName,
        servicePackageName,
        roomName: room?.name ?? null,
        totalAmount: appt.invoice?.totalAmount ? Number(appt.invoice.totalAmount) : null,
        qrCodeDataUrl,
      },
    });

    this.logger.log(`Booking confirmation email sent to ${email} for appointment ${appointmentId}`);
  }

  private async reconcileExpiredHolds(): Promise<void> {
    const stale = await this.prisma.appointment.findMany({
      where: { status: 'PENDING_PAYMENT', holdExpiresAt: { lte: new Date() } },
      select: { id: true }, take: 100,
    });
    for (const appointment of stale) {
      try {
        await this.bookingService.expireHold(appointment.id);
      } catch (error) {
        this.logger.error(`Reconciliation failed for appointment ${appointment.id}`, error);
      }
    }
  }

  private rabbitConfig(): RabbitMqConfig {
    return this.config.getOrThrow<RabbitMqConfig>('rabbitmq');
  }
}
