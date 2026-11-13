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
  authJwtSecret: process.env.AUTH_JWT_SECRET,
  tlsCertFile: process.env.TLS_CERT_FILE || null,
  tlsKeyFile: process.env.TLS_KEY_FILE || null,
  logLevel: process.env.LOG_LEVEL ?? 'info'
});

export function validateConfig(value = config) {
  if (!value.databaseUrl) throw new Error('DATABASE_URL is required');
  if (!value.authJwtSecret || value.authJwtSecret.length < 32) {
    throw new Error('AUTH_JWT_SECRET must contain at least 32 characters');
  }
  if (Boolean(value.tlsCertFile) !== Boolean(value.tlsKeyFile)) {
    throw new Error('TLS_CERT_FILE and TLS_KEY_FILE must be configured together');
  }
  return value;
}
