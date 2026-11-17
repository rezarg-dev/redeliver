import assert from 'node:assert/strict';
import { test } from 'node:test';

import { auth, createTestApp } from './support/helpers.js';

function setup() {
  const ctx = createTestApp();
  const source = ctx.store.sources.create({ name: 'shop' });
  const base = `/api/sources/${source.id}/destinations`;
  return { ...ctx, source, base };
}

test('adding and listing destinations', async () => {
  const { app, base } = setup();

  const created = await app.inject({
    method: 'POST',
    url: base,
    headers: auth,
    payload: { url: 'https://example.com/hooks', secret: 'downstream-secret' },
  });
  assert.equal(created.statusCode, 201);
  const destination = created.json();
  assert.match(destination.id, /^dst_/);
  assert.equal(destination.enabled, true);
  assert.equal(destination.signed, true);
  assert.equal(destination.secret, undefined);

  const listed = await app.inject({ method: 'GET', url: base, headers: auth });
  assert.equal(listed.json().data.length, 1);
});

test('destinations need an http(s) url', async () => {
  const { app, base } = setup();
  const post = (url) => app.inject({ method: 'POST', url: base, headers: auth, payload: { url } });

  assert.equal((await post('not a url')).statusCode, 400);
  assert.equal((await post('ftp://example.com/file')).statusCode, 400);
  assert.equal((await post('http://localhost:9000/hook')).statusCode, 201);
});

test('destinations of an unknown source are a 404', async () => {
  const { app } = setup();
  const response = await app.inject({
    method: 'POST',
    url: '/api/sources/src_missing/destinations',
    headers: auth,
    payload: { url: 'https://example.com' },
  });
  assert.equal(response.statusCode, 404);
});

test('a destination can be paused, changed and removed', async () => {
  const { app, store, source } = setup();
  const destination = store.destinations.create({ sourceId: source.id, url: 'https://a.example/hook' });
  const url = `/api/destinations/${destination.id}`;

  const paused = await app.inject({ method: 'PATCH', url, headers: auth, payload: { enabled: false } });
  assert.equal(paused.statusCode, 200);
  assert.equal(paused.json().enabled, false);
  assert.equal(paused.json().url, 'https://a.example/hook');
  assert.equal(store.destinations.listEnabledBySource(source.id).length, 0);

  const moved = await app.inject({
    method: 'PATCH',
    url,
    headers: auth,
    payload: { url: 'https://b.example/hook', enabled: true },
  });
  assert.equal(moved.json().url, 'https://b.example/hook');
  assert.equal(moved.json().enabled, true);

  const empty = await app.inject({ method: 'PATCH', url, headers: auth, payload: {} });
  assert.equal(empty.statusCode, 400);

  const removed = await app.inject({ method: 'DELETE', url, headers: auth });
  assert.equal(removed.statusCode, 204);
  assert.equal(store.destinations.get(destination.id), undefined);
});
