import assert from 'node:assert/strict';
import { test } from 'node:test';

import { auth, createTestApp } from './support/helpers.js';

test('admin API rejects requests without a valid token', async () => {
  const { app } = createTestApp();

  const missing = await app.inject({ method: 'GET', url: '/api/sources' });
  assert.equal(missing.statusCode, 401);

  const wrong = await app.inject({
    method: 'GET',
    url: '/api/sources',
    headers: { authorization: 'Bearer not-the-token' },
  });
  assert.equal(wrong.statusCode, 401);

  const basic = await app.inject({
    method: 'GET',
    url: '/api/sources',
    headers: { authorization: 'Basic abc' },
  });
  assert.equal(basic.statusCode, 401);
});

test('creating a source returns its secret exactly once', async () => {
  const { app } = createTestApp();

  const created = await app.inject({
    method: 'POST',
    url: '/api/sources',
    headers: auth,
    payload: { name: 'shop' },
  });
  assert.equal(created.statusCode, 201);
  const source = created.json();
  assert.match(source.id, /^src_/);
  assert.match(source.secret, /^whsec_/);
  assert.equal(source.ingest_path, `/in/${source.id}`);

  const fetched = await app.inject({ method: 'GET', url: `/api/sources/${source.id}`, headers: auth });
  assert.equal(fetched.statusCode, 200);
  assert.equal(fetched.json().secret, undefined);

  const listed = await app.inject({ method: 'GET', url: '/api/sources', headers: auth });
  assert.equal(listed.json().data.length, 1);
  assert.equal(listed.json().data[0].secret, undefined);
});

test('source names are unique', async () => {
  const { app } = createTestApp();
  const request = { method: 'POST', url: '/api/sources', headers: auth, payload: { name: 'shop' } };

  assert.equal((await app.inject(request)).statusCode, 201);
  const second = await app.inject(request);
  assert.equal(second.statusCode, 409);
  assert.equal(second.json().error, 'conflict');
});

test('invalid source payloads are rejected', async () => {
  const { app } = createTestApp();
  const post = (payload) => app.inject({ method: 'POST', url: '/api/sources', headers: auth, payload });

  assert.equal((await post({})).statusCode, 400);
  assert.equal((await post({ name: '' })).statusCode, 400);
  assert.equal((await post({ name: 'shop', scheme: 'md5' })).statusCode, 400);
  assert.equal((await post({ name: 'shop', extra: true })).statusCode, 400);
  assert.equal((await post({ name: 'shop' })).statusCode, 201);
});

test('deleting a source', async () => {
  const { app, store } = createTestApp();
  const source = store.sources.create({ name: 'shop' });

  const removed = await app.inject({ method: 'DELETE', url: `/api/sources/${source.id}`, headers: auth });
  assert.equal(removed.statusCode, 204);

  const again = await app.inject({ method: 'DELETE', url: `/api/sources/${source.id}`, headers: auth });
  assert.equal(again.statusCode, 404);
});
