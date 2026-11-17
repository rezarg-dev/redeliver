import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createTestApp } from './support/helpers.js';

function setup() {
  const ctx = createTestApp();
  const source = ctx.store.sources.create({ name: 'shop', scheme: 'none' });
  ctx.store.destinations.create({ sourceId: source.id, url: 'http://localhost:9000/hook' });

  const send = (sourceId, key) =>
    ctx.app.inject({
      method: 'POST',
      url: `/in/${sourceId}`,
      headers: key === undefined ? {} : { 'idempotency-key': key },
      payload: '{"order":42}',
    });

  return { ...ctx, source, send };
}

test('a repeated idempotency key returns the first event and queues nothing', async () => {
  const { store, source, send } = setup();

  const first = await send(source.id, 'order-42');
  assert.equal(first.statusCode, 202);

  const second = await send(source.id, 'order-42');
  assert.equal(second.statusCode, 200);
  assert.deepEqual(second.json(), { id: first.json().id, duplicate: true });

  assert.equal(store.deliveries.listByEvent(first.json().id).length, 1);
});

test('requests without a key are never deduplicated', async () => {
  const { source, send } = setup();
  const first = await send(source.id);
  const second = await send(source.id);
  assert.equal(second.statusCode, 202);
  assert.notEqual(first.json().id, second.json().id);
});

test('the same key on two sources creates two events', async () => {
  const { store, source, send } = setup();
  const other = store.sources.create({ name: 'billing', scheme: 'none' });

  const first = await send(source.id, 'same-key');
  const second = await send(other.id, 'same-key');
  assert.equal(second.statusCode, 202);
  assert.notEqual(first.json().id, second.json().id);
});

test('overlong keys are rejected', async () => {
  const { source, send } = setup();
  const response = await send(source.id, 'k'.repeat(256));
  assert.equal(response.statusCode, 400);
});
