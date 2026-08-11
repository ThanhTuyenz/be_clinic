import { registerAs } from '@nestjs/config';
import { AuthConfig } from './config.type';
import { IsString } from 'class-validator';
import validateConfig from '../common/utils/validate-config.js';

class EnvironmentVariablesValidator {
  @IsString()
  AUTH_JWT_SECRET: string;

  @IsString()
  AUTH_JWT_TOKEN_EXPIRES_IN: string;

  @IsString()
  AUTH_JWT_REFRESH_SECRET: string;

  @IsString()
  AUTH_JWT_REFRESH_TOKEN_EXPIRES_IN: string;
}

const TTL_UNITS = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
} as const;

export function ttlToMilliseconds(value: string): number {
  const match = value.match(/^(\d+)(s|m|h|d)$/i);

  if (!match) {
    const num = Number(value);

    if (!Number.isNaN(num)) {
      return num * 1000;
    }

    throw new Error(
      `Invalid TTL format "${value}". Expected formats like "15m", "7d", or seconds.`,
    );
  }

  const [, amount, unit] = match;

  return Number(amount) * TTL_UNITS[unit.toLowerCase()];
}

export default registerAs<AuthConfig>('auth', () => {
  validateConfig(process.env, EnvironmentVariablesValidator);

  return {
    secret: process.env.AUTH_JWT_SECRET,
    expires: process.env.AUTH_JWT_TOKEN_EXPIRES_IN,
    refreshSecret: process.env.AUTH_JWT_REFRESH_SECRET,
    refreshExpires: process.env.AUTH_JWT_REFRESH_TOKEN_EXPIRES_IN,
  };
});
