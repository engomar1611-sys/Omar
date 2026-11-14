import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const pageUrl = new URL('../web/index.html', import.meta.url);
// ملفات JavaScript ثابتة مسموحة فقط بالاسم (قائمة بيضاء) لتجنب أي قراءة ملفات عشوائية.
const assets = { 'finance-extras.js': new URL('../web/finance-extras.js', import.meta.url) };

export async function webUiRoutes(app) {
  const html = await readFile(fileURLToPath(pageUrl), 'utf8');
  app.get('/', async (_request, reply) => reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(html));
  app.get('/app', async (_request, reply) => reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(html));
  app.get('/assets/:name', async (request, reply) => {
    const url = Object.hasOwn(assets, request.params.name) ? assets[request.params.name] : null;
    if (!url) return reply.code(404).send({ error: 'NOT_FOUND' });
    return reply.type('application/javascript; charset=utf-8').header('Cache-Control', 'no-store')
      .send(await readFile(fileURLToPath(url), 'utf8'));
  });
}
