import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import QRCode from 'qrcode';
import { RabbitMqConfig } from '../../../config/config.type.js';
import { checkInToken } from '../../../modules/appointments/helpers/check-in-token.js';
import { BookingService } from '../../../modules/bookings/booking.service.js';
import { PaymentReconciliationService } from '../../../modules/payments/payment-reconciliation.service.js';
import { RecommendationService } from '../../../modules/recommendations/recommendation.service.js';
import { PrismaService } from '../../database/prisma/prisma.service.js';
import { EmbeddingService, mapPackageForRetrieval } from '../../embedding/embedding.service.js';
import { HttpSmsService } from '../../httpsms/httpsms.service.js';
import { MailsService } from '../../mail/mails.service.js';
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
    private readonly recommendationService: RecommendationService,
    private readonly httpSmsService: HttpSmsService,
    private readonly embeddingService: EmbeddingService,
    private readonly paymentReconciliation: PaymentReconciliationService,
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
    await this.consumeRecommendationTasks();
    await this.consumePackageVectorSync();
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

    // Recommendation profile analyze queue
    await this.channel.assertQueue(topology.recommendationQueue, { durable: true });
    await this.channel.bindQueue(topology.recommendationQueue, topology.eventsExchange, topology.recommendationRoutingKey);

    // Package vector sync queue
    await this.channel.assertQueue(topology.packageVectorSyncQueue, { durable: true });
    await this.channel.bindQueue(topology.packageVectorSyncQueue, topology.eventsExchange, topology.packageVectorSyncRoutingKey);

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
        const isHold = event.eventType === 'appointment.hold.created' || event.eventType === 'booking_order.hold.created';
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
        const payload = JSON.parse(message.content.toString()) as {
          eventId: string;
          appointmentId?: string;
          appointmentIds?: string[];
        };
        const processed = await this.prisma.processedEvent.findUnique({ where: { eventId: payload.eventId } });
        if (!processed) {
          if (payload.appointmentIds?.length) {
            for (const appointmentId of payload.appointmentIds) {
              await this.paymentReconciliation.expireHoldIfUnpaid(appointmentId);
            }
          } else if (payload.appointmentId) {
            await this.paymentReconciliation.expireHoldIfUnpaid(payload.appointmentId);
          } else {
            throw new Error('Hold expiration event thiếu appointmentId/appointmentIds');
          }
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

  private async consumeRecommendationTasks(): Promise<void> {
    await this.channel.consume(topology.recommendationQueue, async (message: any) => {
      if (!message) return;
      try {
        const payload = JSON.parse(message.content.toString()) as {
          eventId?: string;
          profileId: string;
          branchId?: string;
        };
        this.logger.log(`[RabbitMQ] Received recommendation analyze task for profile: ${payload.profileId}`);
        if (payload.eventId) {
          const processed = await this.prisma.processedEvent.findUnique({ where: { eventId: payload.eventId } });
          if (!processed) {
            await this.recommendationService.analyzeAndCacheRecommendations(payload.profileId, undefined, undefined, true);
            await this.prisma.processedEvent.create({
              data: { eventId: payload.eventId, consumer: 'recommendation-analyzer' },
            });
          }
        } else {
          await this.recommendationService.analyzeAndCacheRecommendations(payload.profileId, undefined, undefined, true);
        }
        this.channel.ack(message);
        this.logger.log(`[RabbitMQ] Successfully analyzed & cached recommendations for profile: ${payload.profileId}`);
      } catch (error: any) {
        this.logger.error(`[RabbitMQ] Failed to analyze recommendations for profile: ${error?.message}`, error);
        this.channel.nack(message, false, false);
      }
    }, { noAck: false });
  }

  private async consumePackageVectorSync(): Promise<void> {
    await this.channel.consume(topology.packageVectorSyncQueue, async (message: any) => {
      if (!message) return;
      try {
        const payload = JSON.parse(message.content.toString()) as { eventId?: string; packageId: string };
        if (payload.eventId && await this.prisma.processedEvent.findUnique({ where: { eventId: payload.eventId } })) {
          this.channel.ack(message);
          return;
        }
        // Read the current DB record: older queued events must not overwrite newer metadata.
        const pkg = await this.prisma.servicePackage.findUnique({
          where: { id: payload.packageId },
          include: { specialty: { select: { name: true, description: true, symptoms: true } } },
        });
        if (!pkg?.isActive) {
          await this.embeddingService.invalidatePackageVector(payload.packageId);
        } else {
          const vector = await this.embeddingService.getOrComputePackageVector(mapPackageForRetrieval(pkg));
          if (!vector) throw new Error('Package embedding unavailable');
        }
        if (payload.eventId) {
          await this.prisma.processedEvent.create({ data: { eventId: payload.eventId, consumer: 'package-vector-sync' } });
        }
        this.channel.ack(message);
      } catch (error: any) {
        this.logger.error(`[RabbitMQ] Failed to sync package vector: ${error?.message}`, error);
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
        servicePackage: true,
        invoice: { select: { totalAmount: true } },
        branch: { select: { name: true, address: true, phoneNumber: true } },
      },
    });

    if (!appt) {
      this.logger.warn(`Appointment not found for confirmation email/sms: ${appointmentId}`);
      return;
    }

    const email = appt.patientProfile.account?.email;
    const phone = appt.patientProfile.phoneNumber || appt.patientProfile.account?.phoneNumber;

    if (!email && !phone) {
      this.logger.log(`No email or phone found for patient in appointment ${appointmentId}`);
      return;
    }

    const doctorSlot = appt.scheduleSlot;
    const branch = doctorSlot?.schedule.branch ?? appt.branch;
    const room = doctorSlot?.schedule.room;

    const appointmentDate =
      doctorSlot?.schedule.workDate?.toISOString().slice(0, 10) ??
      new Date().toISOString().slice(0, 10);

    const startTime =
      doctorSlot?.startTime?.toISOString().slice(11, 16) ??
      '';

    const doctorName = doctorSlot?.schedule.doctor
      ? `${doctorSlot.schedule.doctor.academicRank ? doctorSlot.schedule.doctor.academicRank + ' ' : ''}${doctorSlot.schedule.doctor.user?.fullName ?? ''}`.trim()
      : null;

    const servicePackageName = appt.servicePackage?.name ?? null;

    // Sinh mã QR Code base64 Data URL (dùng chung định dạng VITACARE_CHECKIN với Web & Kiosk/Lễ tân)
    let qrCodeDataUrl: string | null = null;
    try {
      const rawToken = checkInToken(appt.id, this.config.get<string>('auth.secret'));
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

    const tasks: Promise<any>[] = [];

    // Gửi Email nếu có
    if (email) {
      tasks.push(
        this.mailsService.sendBookingConfirmation({
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
        }).then(() => {
          this.logger.log(`Booking confirmation email sent to ${email} for appointment ${appointmentId}`);
        }).catch((err) => {
          this.logger.error(`Failed to send booking email to ${email}: ${err?.message}`);
        })
      );
    }

    // Gửi tin nhắn SMS qua httpSMS nếu có số điện thoại
    if (phone) {
      tasks.push(
        this.httpSmsService.sendBookingConfirmation({
          to: phone,
          patientName: appt.patientProfile.fullName,
          bookingCode: appt.bookingCode ?? appt.id,
          appointmentDate,
          startTime,
          branchName: branch?.name ?? 'VitaCare Clinic',
          branchAddress: branch?.address ?? undefined,
          branchPhone: branch?.phoneNumber ?? undefined,
          doctorName: doctorName ?? undefined,
          serviceName: servicePackageName ?? undefined,
        }).catch((err) => {
          this.logger.error(`Failed to send booking SMS to ${phone}: ${err?.message}`);
        })
      );
    }

    await Promise.allSettled(tasks);
  }

  private async reconcileExpiredHolds(): Promise<void> {
    const stale = await this.prisma.appointment.findMany({
      where: { status: 'HOLD', holdExpiresAt: { lte: new Date() } },
      select: { id: true }, take: 100,
    });
    for (const appointment of stale) {
      try {
        await this.paymentReconciliation.expireHoldIfUnpaid(appointment.id);
      } catch (error) {
        this.logger.error(`Reconciliation failed for appointment ${appointment.id}`, error);
      }
    }
  }

  private rabbitConfig(): RabbitMqConfig {
    return this.config.getOrThrow<RabbitMqConfig>('rabbitmq');
  }
}
