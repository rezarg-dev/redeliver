import assert from 'node:assert/strict';
import { test } from 'node:test';

import { auth, createTestApp } from './support/helpers.js';

function setup() {
  const ctx = createTestApp();
  const source = ctx.store.sources.create({ name: 'shop', scheme: 'none' });
  const destination = ctx.store.destinations.create({
    sourceId: source.id,
    url: 'http://localhost:9000/hook',
  });

  const ingest = async (payload = '{"order":42}', sourceId = source.id) => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/in/${sourceId}`,
      headers: { 'content-type': 'application/json', 'x-shop-topic': 'orders/create' },
      payload,
    });
    return response.json().id;
  };
  const get = (url) => ctx.app.inject({ method: 'GET', url, headers: auth });
  const post = (url) => ctx.app.inject({ method: 'POST', url, headers: auth });

  return { ...ctx, source, destination, ingest, get, post };
}

test('event detail shows headers, body and deliveries', async () => {
  const { destination, ingest, get } = setup();
  const id = await ingest();

  const response = await get(`/api/events/${id}`);
  assert.equal(response.statusCode, 200);
  const event = response.json();
  assert.equal(event.body, '{"order":42}');
  assert.equal(event.body_encoding, 'utf8');
  assert.equal(event.size, 12);
  assert.equal(event.headers['x-shop-topic'], 'orders/create');
  assert.equal(event.deliveries.length, 1);
  assert.equal(event.deliveries[0].destination_id, destination.id);
  assert.equal(event.deliveries[0].status, 'pending');

  assert.equal((await get('/api/events/evt_missing')).statusCode, 404);
});

test('binary bodies are returned as base64', async () => {
  const { app, source, get } = setup();
  const bytes = Buffer.from([0xff, 0xfe, 0x00, 0x01]);
  const ingested = await app.inject({
    method: 'POST',
    url: `/in/${source.id}`,
    headers: { 'content-type': 'application/octet-stream' },
    payload: bytes,
  });

  const event = (await get(`/api/events/${ingested.json().id}`)).json();
  assert.equal(event.body_encoding, 'base64');
  assert.deepEqual(Buffer.from(event.body, 'base64'), bytes);
});

test('events are listed newest first and paginated without gaps', async () => {
  const { ingest, get } = setup();
  const ids = [];
  for (let i = 0; i < 5; i += 1) ids.push(await ingest(`{"n":${i}}`));
  const newestFirst = ids.toReversed();

  const first = (await get('/api/events?limit=2')).json();
  assert.deepEqual(first.data.map((event) => event.id), newestFirst.slice(0, 2));
  assert.equal(first.data[0].body, undefined);
  assert.ok(first.next_cursor);

  const second = (await get(`/api/events?limit=2&cursor=${first.next_cursor}`)).json();
  assert.deepEqual(second.data.map((event) => event.id), newestFirst.slice(2, 4));

  const third = (await get(`/api/events?limit=2&cursor=${second.next_cursor}`)).json();
  assert.deepEqual(third.data.map((event) => event.id), newestFirst.slice(4));
  assert.equal(third.next_cursor, null);
});

test('a page that ends exactly on the last row has no next cursor', async () => {
  const { ingest, get } = setup();
  await ingest();
  await ingest();
  const page = (await get('/api/events?limit=2')).json();
  assert.equal(page.data.length, 2);
  assert.equal(page.next_cursor, null);
});

test('events can be filtered by source', async () => {
  const { store, ingest, get } = setup();
  const other = store.sources.create({ name: 'billing', scheme: 'none' });
  await ingest();
  const id = await ingest('{}', other.id);

  const page = (await get(`/api/events?source_id=${other.id}`)).json();
  assert.deepEqual(page.data.map((event) => event.id), [id]);
});

test('invalid list parameters are rejected', async () => {
  const { get } = setup();
  assert.equal((await get('/api/events?limit=0')).statusCode, 400);
  assert.equal((await get('/api/events?limit=101')).statusCode, 400);
  assert.equal((await get('/api/events?limit=abc')).statusCode, 400);
  assert.equal((await get('/api/events?order=asc')).statusCode, 400);
});

test('replaying an event queues it for the currently enabled destinations', async () => {
  const { store, source, destination, ingest, post } = setup();
  const id = await ingest();

  // One destination added after the event arrived, the original one paused.
  const added = store.destinations.create({ sourceId: source.id, url: 'http://localhost:9001/hook' });
  store.destinations.update(destination.id, { enabled: false });

  const response = await post(`/api/events/${id}/replay`);
  assert.equal(response.statusCode, 202);
  assert.deepEqual(
    response.json().deliveries.map((delivery) => delivery.destination_id),
    [added.id],
  );
  assert.equal(store.deliveries.listByEvent(id).length, 2);

  assert.equal((await post('/api/events/evt_missing/replay')).statusCode, 404);
});
