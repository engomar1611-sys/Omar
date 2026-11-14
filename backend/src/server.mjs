import { buildApp } from './app.mjs';
import { config, validateConfig } from './config/env.mjs';
import { loadHttpsOptions } from './config/tls.mjs';
import { pool } from './db/pool.mjs';

validateConfig();

const https = loadHttpsOptions(config);
const app = buildApp({
  logger: { level: config.logLevel },
  ...(https ? { https } : {})
});

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info(
    { host: config.host, port: config.port, protocol: https ? 'https' : 'http' },
    'NEW FEED ERP API started'
  );
} catch (error) {
  app.log.error(error);
  await pool.end();
  process.exit(1);
}

async function shutdown(signal) {
  app.log.info({ signal }, 'Shutting down NEW FEED ERP API');
  try {
    await app.close();
    await pool.end();
    process.exit(0);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
