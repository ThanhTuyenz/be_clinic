import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { RedisConfig } from '../../config/config.type.js';

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

  async deletePattern(pattern: string): Promise<void> {
    if (!this.client) return;
    try {
      const prefix = this.config().keyPrefix || '';
      const fullPattern = prefix ? `${prefix}${pattern}` : pattern;
      const keys = await this.client.keys(fullPattern);
      if (keys.length > 0) {
        const cleanKeys = prefix ? keys.map((k) => (k.startsWith(prefix) ? k.slice(prefix.length) : k)) : keys;
        await this.client.del(...cleanKeys);
      }
    } catch (err: any) {
      this.logger.warn(`Failed to delete keys matching pattern ${pattern}: ${err?.message}`);
    }
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

  async sadd(key: string, ...members: string[]): Promise<void> {
    if (!this.client || members.length === 0) return;
    await this.client.sadd(key, ...members);
  }

  async srem(key: string, ...members: string[]): Promise<void> {
    if (!this.client || members.length === 0) return;
    await this.client.srem(key, ...members);
  }

  async smembers(key: string): Promise<string[]> {
    if (!this.client) return [];
    return await this.client.smembers(key);
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    if (!this.client) return;
    await this.client.expire(key, ttlSeconds);
  }

  async exists(key: string): Promise<boolean> {
    if (!this.client) return false;
    return (await this.client.exists(key)) === 1;
  }

  async hincrby(key: string, field: string, increment: number): Promise<number> {
    if (!this.client) return 0;
    return await this.client.hincrby(key, field, increment);
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    if (!this.client) return 0;
    return await this.client.hset(key, field, value);
  }

  async hget(key: string, field: string): Promise<string | null> {
    if (!this.client) return null;
    return await this.client.hget(key, field);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    if (!this.client) return {};
    return await this.client.hgetall(key);
  }

  getClient(): Redis | undefined {
    return this.client;
  }

  /**
   * Gọi trực tiếp một lệnh Redis tùy ý (hỗ trợ RediSearch FT.SEARCH, FT.CREATE, v.v.)
   */
  async call(command: string, ...args: (string | number | Buffer)[]): Promise<any> {
    if (!this.client) return null;
    return (this.client as any).call(command, ...args);
  }

  private config(): RedisConfig {
    return this.configService.getOrThrow<RedisConfig>('redis');
  }
}
