import { registerAs } from '@nestjs/config';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import validateConfig from '../../../common/utils/validate-config.js';
import { RedisConfig } from '../../../config/config.type.js';

class RedisEnvironmentValidator {
  @IsBoolean() @IsOptional() REDIS_ENABLED?: boolean;
  @IsString() @IsOptional() REDIS_URL?: string;
  @IsString() @IsOptional() REDIS_KEY_PREFIX?: string;
  @IsInt() @Min(0) @Max(15) @IsOptional() REDIS_DB?: number;
  @IsInt() @Min(1) @IsOptional() REDIS_DEFAULT_TTL_SECONDS?: number;
  @IsInt() @Min(100) @IsOptional() REDIS_CONNECT_TIMEOUT_MS?: number;
}

export default registerAs<RedisConfig>('redis', () => {
  const env = validateConfig(process.env, RedisEnvironmentValidator);
  return {
    enabled: env.REDIS_ENABLED ?? false,
    url: env.REDIS_URL,
    keyPrefix: env.REDIS_KEY_PREFIX ?? 'vitacare:',
    db: env.REDIS_DB ?? 0,
    defaultTtlSeconds: env.REDIS_DEFAULT_TTL_SECONDS ?? 300,
    connectTimeoutMs: env.REDIS_CONNECT_TIMEOUT_MS ?? 5_000,
  };
});
