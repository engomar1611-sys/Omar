import Fastify from 'fastify';
import { checkDatabase } from './db/pool.mjs';

export function buildApp({ logger = true } = {}) {
  const app = Fastify({ logger });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'new-feed-erp-api',
    timestamp: new Date().toISOString()
  }));

  app.get('/ready', async (_request, reply) => {
    try {
      await checkDatabase();
      return { status: 'ready', database: 'connected' };
    } catch {
      return reply.code(503).send({
        status: 'not_ready',
        database: 'unavailable'
      });
    }
  });

  app.get('/api/v1', async () => ({
    name: 'NEW FEED ERP API',
    version: '0.1.0',
    status: 'foundation'
  }));

  return app;
}
