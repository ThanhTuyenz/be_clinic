import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { RedisConfig } from '../../../config/config.type.js';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client?: Redis;

  constructor(private readonly configService: ConfigService) { }

  async onModuleInit(): Promise<void> {
    const config = this.config();
    if (!config.enabled) {
      this.logger.warn('Redis disabled; cache operations will be bypassed');
      return;
    }
    if (!config.url) throw new Error('REDIS_URL is required when Redis is enabled');
    this.client = new Redis(config.url, {
      db: config.db,
      keyPrefix: config.keyPrefix,
      connectTimeout: config.connectTimeoutMs,
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      retryStrategy: (attempt) => Math.min(attempt * 200, 2_000),
    });
    this.client.on('error', (error) => this.logger.error('Redis connection error', error));
    await this.client.connect();
    await this.client.ping();
    this.logger.log('Redis connected');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) await this.client.quit();
  }

  isEnabled(): boolean {
    return Boolean(this.client);
  }

  async ping(): Promise<boolean> {
    if (!this.client) return false;
    return (await this.client.ping()) === 'PONG';
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.client) return null;
    const value = await this.client.get(key);
    return value === null ? null : JSON.parse(value) as T;
  }

  async set<T>(key: string, value: T, ttlSeconds = this.config().defaultTtlSeconds): Promise<void> {
    if (!this.client) return;
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async delete(...keys: string[]): Promise<void> {
    if (!this.client || keys.length === 0) return;
    await this.client.del(...keys);
  }

  async acquireLock(key: string, ttlMs: number): Promise<string | null> {
    if (!this.client) return null;
    const token = randomUUID();
    const result = await this.client.set(`lock:${key}`, token, 'PX', ttlMs, 'NX');
    return result === 'OK' ? token : null;
  }

  async releaseLock(key: string, token: string): Promise<boolean> {
    if (!this.client) return false;
    const result = await this.client.eval(
      'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
      1,
      `lock:${key}`,
      token,
    );
    return result === 1;
  }

  private config(): RedisConfig {
    return this.configService.getOrThrow<RedisConfig>('redis');
  }
}
