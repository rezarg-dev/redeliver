import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sign } from '../src/signature.js';
import { auth, createTestApp } from './support/helpers.js';

function setup(options = {}) {
  const ctx = createTestApp(options.config);
  const source = ctx.store.sources.create({ name: 'shop', scheme: options.scheme });
  const destination = ctx.store.destinations.create({
    sourceId: source.id,
    url: 'http://localhost:9000/hook',
  });

  const send = (payload, headers = {}) =>
    ctx.app.inject({
      method: 'POST',
      url: `/in/${source.id}`,
      headers: {
        'content-type': 'application/json',
        'x-signature': sign(source.secret, payload),
        ...headers,
      },
      payload,
    });

  return { ...ctx, source, destination, send };
}

test('a signed webhook is stored and queued for every destination', async () => {
  const { store, source, destination, send } = setup();
  store.destinations.create({ sourceId: source.id, url: 'http://localhost:9001/hook' });
  const payload = '{"order":42}';

  const response = await send(payload);
  assert.equal(response.statusCode, 202);
  const { id, deliveries } = response.json();
  assert.equal(deliveries, 2);

  const event = store.events.get(id);
  assert.equal(event.source_id, source.id);
  assert.equal(event.body.toString(), payload);
  assert.equal(event.content_type, 'application/json');

  const queued = store.deliveries.listByEvent(id);
  assert.equal(queued.length, 2);
  assert.equal(queued[0].status, 'pending');
  assert.equal(queued[0].destination_id, destination.id);
});

test('the signature covers the exact bytes of the body', async () => {
  const { source, send } = setup();
  // Same JSON value, different whitespace: must not verify.
  const response = await send('{"order": 42}', { 'x-signature': sign(source.secret, '{"order":42}') });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error, 'invalid_signature');
});

test('unsigned and unknown-source requests are rejected', async () => {
  const { app, send } = setup();

  const unsigned = await send('{}', { 'x-signature': '' });
  assert.equal(unsigned.statusCode, 401);

  const unknown = await app.inject({ method: 'POST', url: '/in/src_missing', payload: '{}' });
  assert.equal(unknown.statusCode, 404);
});

test('any content type is accepted, including none and an empty body', async () => {
  const { app, store, source, send } = setup();

  const form = await send('a=1&b=2', { 'content-type': 'application/x-www-form-urlencoded' });
  assert.equal(form.statusCode, 202);
  assert.equal(store.events.get(form.json().id).body.toString(), 'a=1&b=2');

  const binary = Buffer.from([0x00, 0xff, 0x10]);
  const raw = await send(binary, { 'content-type': 'application/octet-stream' });
  assert.equal(raw.statusCode, 202);
  assert.deepEqual(store.events.get(raw.json().id).body, binary);

  const empty = await app.inject({
    method: 'POST',
    url: `/in/${source.id}`,
    headers: { 'x-signature': sign(source.secret, '') },
  });
  assert.equal(empty.statusCode, 202);
  assert.equal(store.events.get(empty.json().id).body.length, 0);
});

test('only custom x- headers are kept with the event', async () => {
  const { store, send } = setup();
  const response = await send('{}', {
    'x-shop-topic': 'orders/create',
    'x-forwarded-for': '10.0.0.1',
    'x-redeliver-attempt': '99',
    authorization: 'Bearer leaked',
    cookie: 'session=1',
  });

  const headers = JSON.parse(store.events.get(response.json().id).headers);
  assert.equal(headers['x-shop-topic'], 'orders/create');
  assert.equal(headers['x-forwarded-for'], undefined);
  assert.equal(headers['x-redeliver-attempt'], undefined);
  assert.equal(headers.authorization, undefined);
  assert.equal(headers.cookie, undefined);
});

test('paused destinations do not get new deliveries', async () => {
  const { store, destination, send } = setup();
  store.destinations.update(destination.id, { enabled: false });

  const response = await send('{}');
  assert.equal(response.statusCode, 202);
  assert.equal(response.json().deliveries, 0);
});

test('sources with scheme "none" accept unsigned requests', async () => {
  const { app, source } = setup({ scheme: 'none' });
  const response = await app.inject({ method: 'POST', url: `/in/${source.id}`, payload: 'hello' });
  assert.equal(response.statusCode, 202);
});

test('bodies over the size limit are rejected', async () => {
  const { send } = setup({ config: { maxBodyBytes: 64 } });
  const response = await send('x'.repeat(65));
  assert.equal(response.statusCode, 413);
  assert.equal(response.json().error, 'payload_too_large');
});

test('the admin API still parses JSON', async () => {
  const { app } = setup();
  const response = await app.inject({
    method: 'POST',
    url: '/api/sources',
    headers: auth,
    payload: { name: 'second' },
  });
  assert.equal(response.statusCode, 201);
});
