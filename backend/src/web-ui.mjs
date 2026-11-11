import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const pageUrl = new URL('../web/index.html', import.meta.url);

export async function webUiRoutes(app) {
  const html = await readFile(fileURLToPath(pageUrl), 'utf8');
  app.get('/', async (_request, reply) => reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(html));
  app.get('/app', async (_request, reply) => reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(html));
}
