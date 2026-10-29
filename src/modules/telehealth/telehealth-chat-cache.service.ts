import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import { ChatMessagePayload } from './types/telehealth.types.js';

export interface ChatSnapshot {
  messages: ChatMessagePayload[];
  startedAt?: string;
}

@Injectable()
export class TelehealthChatCache {
  constructor(private readonly redis: RedisService) {}

  private client() {
    const client = this.redis.getClient();
    if (!client) throw new ServiceUnavailableException('Chưa kết nối dịch vụ lưu chat. Vui lòng thử lại.');
    return client;
  }

  private keys(appointmentId: string) {
    return [`telehealth:{${appointmentId}}:chat:state`, `telehealth:{${appointmentId}}:chat:messages`];
  }

  async append(appointmentId: string, message: ChatMessagePayload, startedAt: Date) {
    const result = await this.client().eval(`
      local status = redis.call('HGET', KEYS[1], 'status')
      if status == 'closing' or status == 'closed' then return 0 end
      redis.call('HSETNX', KEYS[1], 'startedAt', ARGV[2])
      redis.call('HSET', KEYS[1], 'status', 'open')
      redis.call('RPUSH', KEYS[2], ARGV[1])
      return 1
    `, 2, ...this.keys(appointmentId), JSON.stringify(message), startedAt.toISOString());
    if (Number(result) !== 1) throw new ConflictException('Phiên tư vấn đang hoàn tất hoặc đã kết thúc.');
  }

  private decode(result: unknown): ChatSnapshot {
    const [startedAt, messages] = result as [string, string[]];
    return { startedAt: startedAt || undefined, messages: messages.map(message => JSON.parse(message) as ChatMessagePayload) };
  }

  async read(appointmentId: string): Promise<ChatSnapshot> {
    return this.decode(await this.client().eval(`
      return {redis.call('HGET', KEYS[1], 'startedAt') or '', redis.call('LRANGE', KEYS[2], 0, -1)}
    `, 2, ...this.keys(appointmentId)));
  }

  // Freeze atomically before taking the snapshot, so no accepted message can be missed by the DB write.
  async freeze(appointmentId: string): Promise<ChatSnapshot> {
    return this.decode(await this.client().eval(`
      if redis.call('HGET', KEYS[1], 'status') ~= 'closed' then
        redis.call('HSET', KEYS[1], 'status', 'closing')
      end
      return {redis.call('HGET', KEYS[1], 'startedAt') or '', redis.call('LRANGE', KEYS[2], 0, -1)}
    `, 2, ...this.keys(appointmentId)));
  }

  // Only called after the DB transaction commits. Keep the closed marker to reject stale sockets.
  async complete(appointmentId: string) {
    await this.client().eval(`
      redis.call('HSET', KEYS[1], 'status', 'closed')
      redis.call('DEL', KEYS[2])
      return 1
    `, 2, ...this.keys(appointmentId));
  }
}
