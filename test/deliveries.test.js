import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createWorker } from '../src/worker.js';
import { auth, createTestApp } from './support/helpers.js';

function setup(responses = []) {
  const ctx = createTestApp({ maxAttempts: 2 });
  const source = ctx.store.sources.create({ name: 'shop', scheme: 'none' });
  const destination = ctx.store.destinations.create({
    sourceId: source.id,
    url: 'http://localhost:9000/hook',
  });

  const clock = { now: Date.now() };
  const worker = createWorker({
    store: ctx.store,
    config: ctx.config,
    now: () => clock.now,
    fetch: async () => new Response(null, { status: responses.shift() ?? 200 }),
  });
  // Runs the worker until nothing is due, jumping over the retry delays.
  const drain = async () => {
    do {
      clock.now += ctx.config.backoffMaxMs;
    } while ((await worker.tick()) > 0);
  };

  const enqueue = () => {
    const event = ctx.store.events.create({ sourceId: source.id, headers: {}, body: Buffer.from('{}') });
    return ctx.store.deliveries.enqueue({ eventId: event.id, destinationId: destination.id });
  };
  const get = (url) => ctx.app.inject({ method: 'GET', url, headers: auth });
  const post = (url) => ctx.app.inject({ method: 'POST', url, headers: auth });

  return { ...ctx, source, destination, drain, enqueue, get, post };
}

test('delivery detail includes the attempt history', async () => {
  const { drain, enqueue, get } = setup([500, 200]);
  const delivery = enqueue();
  await drain();

  const response = await get(`/api/deliveries/${delivery.id}`);
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.status, 'delivered');
  assert.equal(body.attempts, 2);
  assert.equal(body.next_attempt_at, null);
  assert.deepEqual(
    body.history.map((attempt) => attempt.status_code),
    [500, 200],
  );

  assert.equal((await get('/api/deliveries/dlv_missing')).statusCode, 404);
});

test('deliveries can be filtered by status and event', async () => {
  const { drain, enqueue, get } = setup([500, 500]);
  const dead = enqueue();
  await drain();
  const pending = enqueue();

  const all = (await get('/api/deliveries')).json();
  assert.deepEqual(all.data.map((delivery) => delivery.id), [pending.id, dead.id]);

  const onlyDead = (await get('/api/deliveries?status=dead')).json();
  assert.deepEqual(onlyDead.data.map((delivery) => delivery.id), [dead.id]);

  const byEvent = (await get(`/api/deliveries?event_id=${pending.event_id}`)).json();
  assert.deepEqual(byEvent.data.map((delivery) => delivery.id), [pending.id]);

  assert.equal((await get('/api/deliveries?status=lost')).statusCode, 400);
});

test('deliveries are paginated', async () => {
  const { enqueue, get } = setup();
  const ids = [enqueue().id, enqueue().id, enqueue().id];

  const first = (await get('/api/deliveries?limit=2')).json();
  assert.deepEqual(first.data.map((delivery) => delivery.id), [ids[2], ids[1]]);

  const second = (await get(`/api/deliveries?limit=2&cursor=${first.next_cursor}`)).json();
  assert.deepEqual(second.data.map((delivery) => delivery.id), [ids[0]]);
  assert.equal(second.next_cursor, null);
});

test('a dead delivery can be retried and gets a fresh attempt budget', async () => {
  const { store, drain, enqueue, post } = setup([500, 500, 200]);
  const delivery = enqueue();
  await drain();
  assert.equal(store.deliveries.get(delivery.id).status, 'dead');

  const response = await post(`/api/deliveries/${delivery.id}/retry`);
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().status, 'pending');
  assert.equal(response.json().attempts, 0);

  await drain();
  assert.equal(store.deliveries.get(delivery.id).status, 'delivered');
  // The history keeps the earlier failures.
  assert.equal(store.deliveries.listAttempts(delivery.id).length, 3);
});

test('a delivered delivery cannot be retried', async () => {
  const { drain, enqueue, post } = setup();
  const delivery = enqueue();
  await drain();

  const response = await post(`/api/deliveries/${delivery.id}/retry`);
  assert.equal(response.statusCode, 409);
  assert.match(response.json().message, /Replay the event/);

  assert.equal((await post('/api/deliveries/dlv_missing/retry')).statusCode, 404);
});
