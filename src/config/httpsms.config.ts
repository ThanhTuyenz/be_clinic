import { registerAs } from '@nestjs/config';
import { HttpSmsConfig } from './config.type.js';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import validateConfig from '../common/utils/validate-config.js';

class EnvironmentVariablesValidator {
  @IsBoolean()
  @IsOptional()
  HTTPSMS_ENABLED?: boolean;

  @IsString()
  @IsOptional()
  HTTPSMS_API_KEY?: string;

  @IsString()
  @IsOptional()
  HTTPSMS_FROM_NUMBER?: string;

  @IsBoolean()
  @IsOptional()
  HTTPSMS_SANDBOX?: boolean;

  @IsString()
  @IsOptional()
  HTTPSMS_ENDPOINT?: string;
}

export default registerAs<HttpSmsConfig>('httpsms', () => {
  validateConfig(process.env, EnvironmentVariablesValidator);

  const enabled = process.env.HTTPSMS_ENABLED !== 'false';
  const isSandbox = process.env.HTTPSMS_SANDBOX === 'true' || !process.env.HTTPSMS_API_KEY;

  return {
    enabled,
    apiKey: process.env.HTTPSMS_API_KEY,
    fromNumber: process.env.HTTPSMS_FROM_NUMBER || '+84987654321',
    isSandbox,
    endpoint: process.env.HTTPSMS_ENDPOINT || 'https://api.httpsms.com/v1/messages/send',
  };
});
