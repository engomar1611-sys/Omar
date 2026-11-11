import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.mjs';

test('health endpoint returns service status', async () => {
  const app = buildApp({ logger: false });
  try {
    const response = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'new-feed-erp-api');
    assert.ok(body.timestamp);
  } finally {
    await app.close();
  }
});

test('API root identifies NEW FEED ERP', async () => {
  const app = buildApp({ logger: false });
  try {
    const response = await app.inject({ method: 'GET', url: '/api/v1' });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().name, 'NEW FEED ERP API');
  } finally {
    await app.close();
  }
});
