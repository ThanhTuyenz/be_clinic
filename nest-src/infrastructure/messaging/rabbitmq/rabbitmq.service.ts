import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { PrismaService } from '../../database/prisma/prisma.service.js';
import { BookingService } from '../../../modules/appointments/booking.service.js';
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
    const rabbit = this.rabbitConfig();
    await this.channel.assertExchange(topology.holdExchange, 'direct', { durable: true });
    await this.channel.assertExchange(topology.expiredExchange, 'direct', { durable: true });
    await this.channel.assertExchange(topology.retryExchange, 'direct', { durable: true });
    await this.channel.assertQueue(topology.holdWaitQueue, {
      durable: true,
      arguments: {
        'x-message-ttl': rabbit.holdTtlMs,
        'x-dead-letter-exchange': topology.expiredExchange,
        'x-dead-letter-routing-key': topology.expiredRoutingKey,
      },
    });
    await this.channel.bindQueue(topology.holdWaitQueue, topology.holdExchange, topology.holdRoutingKey);
    await this.channel.assertQueue(topology.expiredQueue, {
      durable: true,
      arguments: { 'x-dead-letter-exchange': topology.retryExchange, 'x-dead-letter-routing-key': topology.failedRoutingKey },
    });
    await this.channel.bindQueue(topology.expiredQueue, topology.expiredExchange, topology.expiredRoutingKey);
    await this.channel.assertQueue(topology.deadLetterQueue, { durable: true });
    await this.channel.bindQueue(topology.deadLetterQueue, topology.retryExchange, topology.failedRoutingKey);
    await this.channel.prefetch(rabbit.prefetch);
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
        this.channel.publish(
          isHold ? topology.holdExchange : 'amq.topic',
          isHold ? topology.holdRoutingKey : event.eventType,
          Buffer.from(JSON.stringify({ eventId: event.id, ...event.payload as object })),
          { persistent: true, messageId: event.id, contentType: 'application/json' },
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
