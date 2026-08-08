import { registerAs } from '@nestjs/config';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import validateConfig from '../../../common/utils/validate-config.js';
import { RabbitMqConfig } from '../../../config/config.type.js';

class RabbitMqEnvironmentValidator {
  @IsBoolean() @IsOptional() RABBITMQ_ENABLED?: boolean;
  @IsString() @IsOptional() RABBITMQ_URL?: string;
  @IsInt() @Min(1_000) @IsOptional() RABBITMQ_HOLD_TTL_MS?: number;
  @IsInt() @Min(1) @Max(1_000) @IsOptional() RABBITMQ_PREFETCH?: number;
  @IsInt() @Min(1) @Max(1_000) @IsOptional() RABBITMQ_OUTBOX_BATCH_SIZE?: number;
  @IsInt() @Min(500) @IsOptional() RABBITMQ_OUTBOX_POLL_MS?: number;
}

export default registerAs<RabbitMqConfig>('rabbitmq', () => {
  const env = validateConfig(process.env, RabbitMqEnvironmentValidator);
  return {
    enabled: env.RABBITMQ_ENABLED ?? false,
    url: env.RABBITMQ_URL,
    holdTtlMs: env.RABBITMQ_HOLD_TTL_MS ?? 600_000,
    prefetch: env.RABBITMQ_PREFETCH ?? 10,
    outboxBatchSize: env.RABBITMQ_OUTBOX_BATCH_SIZE ?? 50,
    outboxPollMs: env.RABBITMQ_OUTBOX_POLL_MS ?? 3_000,
  };
});
