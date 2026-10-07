import { registerAs } from '@nestjs/config';
import { GeminiConfig } from './config.type.js';
import { IsOptional, IsString } from 'class-validator';
import validateConfig from '../common/utils/validate-config.js';

class EnvironmentVariablesValidator {
  @IsString()
  @IsOptional()
  GEMINI_API_KEY?: string;

  @IsString()
  @IsOptional()
  GEMINI_MODEL?: string;
}

export default registerAs<GeminiConfig>('gemini', () => {
  validateConfig(process.env, EnvironmentVariablesValidator);

  return {
    apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  };
});
