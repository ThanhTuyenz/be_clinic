import { registerAs } from '@nestjs/config';

const outputLimit = (name: string, fallback: number) => {
  const value = process.env[name];
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 256 || parsed > 16384) {
    throw new Error(`${name} must be an integer between 256 and 16384`);
  }
  return parsed;
};

export default registerAs('openai', () => ({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL || 'gpt-6-luna',
  intakeModel: process.env.OPENAI_INTAKE_MODEL || 'gpt-4o-mini',
  intakeMaxOutputTokens: outputLimit('OPENAI_INTAKE_MAX_OUTPUT_TOKENS', 650),
  chatMaxOutputTokens: outputLimit('OPENAI_CHAT_MAX_OUTPUT_TOKENS', 1800),
  embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
}));
