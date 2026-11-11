import 'dotenv/config';

function positiveInteger(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return parsed;
}

export const config = Object.freeze({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  host: process.env.HOST ?? '127.0.0.1',
  port: positiveInteger(process.env.PORT, 3000, 'PORT'),
  databaseUrl: process.env.DATABASE_URL,
  logLevel: process.env.LOG_LEVEL ?? 'info'
});

export function validateConfig(value = config) {
  if (!value.databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  return value;
}
