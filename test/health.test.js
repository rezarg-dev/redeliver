import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createTestApp } from './support/helpers.js';

test('GET /healthz reports ok when the database answers', async () => {
  const { app } = createTestApp();
  const response = await app.inject({ method: 'GET', url: '/healthz' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok' });
});

test('GET /healthz returns 503 when the database is gone', async () => {
  const { app, db } = createTestApp();
  db.close();
  const response = await app.inject({ method: 'GET', url: '/healthz' });
  assert.equal(response.statusCode, 503);
});

test('unknown routes get a JSON 404', async () => {
  const { app } = createTestApp();
  const response = await app.inject({ method: 'GET', url: '/nope' });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error, 'not_found');
});
