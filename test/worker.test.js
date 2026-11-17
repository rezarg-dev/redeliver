import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openDatabase } from '../src/db.js';
import { sign } from '../src/signature.js';
import { createStore } from '../src/store/index.js';
import { createWorker } from '../src/worker.js';
import { testConfig } from './support/helpers.js';

const START = Date.parse('2026-01-01T00:00:00Z');

/**
 * Worker wired to a fake fetch and a clock the test moves by hand.
 * `responses` is a queue: each call to fetch takes the next entry, which is
 * a status code, a Response, an Error to throw, or a function to call.
 */
function setup({ config = {}, responses = [], secret = null } = {}) {
  const db = openDatabase(':memory:');
  const store = createStore(db);
  const clock = { now: START };
  const requests = [];

  const fetch = async (url, init) => {
    requests.push({ url, ...init });
    const next = responses.length > 0 ? responses.shift() : 200;
    if (typeof next === 'function') return next();
    if (next instanceof Error) throw next;
    if (next instanceof Response) return next;
    return new Response(null, { status: next });
  };

  const worker = createWorker({
    store,
    config: testConfig({ maxAttempts: 3, backoffBaseMs: 1000, backoffMaxMs: 60_000, ...config }),
    fetch,
    now: () => clock.now,
    random: () => 1,
  });

  const source = store.sources.create({ name: 'shop' });
  const destination = store.destinations.create({
    sourceId: source.id,
    url: 'http://receiver.test/hook',
    secret,
  });

  const enqueue = (body = '{"order":42}', target = destination) => {
    const event = store.events.create({
      sourceId: source.id,
      contentType: 'application/json',
      headers: { 'x-shop-topic': 'orders/create' },
      body: Buffer.from(body),
    });
    return store.deliveries.enqueue({ eventId: event.id, destinationId: target.id, at: clock.now });
  };

  return { db, store, worker, clock, requests, source, destination, enqueue };
}

test('delivers a pending event to its destination', async () => {
  const { store, worker, requests, enqueue } = setup();
  const delivery = enqueue();

  assert.equal(await worker.tick(), 1);

  assert.equal(requests.length, 1);
  const [request] = requests;
  assert.equal(request.url, 'http://receiver.test/hook');
  assert.equal(request.method, 'POST');
  assert.equal(request.body.toString(), '{"order":42}');
  assert.equal(request.headers['content-type'], 'application/json');
  assert.equal(request.headers['x-shop-topic'], 'orders/create');
  assert.equal(request.headers['x-redeliver-delivery'], delivery.id);
  assert.equal(request.headers['x-redeliver-event'], delivery.event_id);
  assert.equal(request.headers['x-redeliver-attempt'], '1');
  assert.equal(request.headers['x-redeliver-signature'], undefined);

  const after = store.deliveries.get(delivery.id);
  assert.equal(after.status, 'delivered');
  assert.equal(after.attempts, 1);
  assert.equal(after.last_status_code, 200);
});

test('signs outgoing requests when the destination has a secret', async () => {
  const { worker, requests, enqueue } = setup({ secret: 'downstream-secret' });
  enqueue('{"a":1}');
  await worker.tick();

  assert.equal(
    requests[0].headers['x-redeliver-signature'],
    `sha256=${sign('downstream-secret', '{"a":1}')}`,
  );
});

test('a failed delivery is retried with growing delays', async () => {
  const { store, worker, clock, requests, enqueue } = setup({ responses: [500, 503, 200] });
  const delivery = enqueue();

  await worker.tick();
  let state = store.deliveries.get(delivery.id);
  assert.equal(state.status, 'pending');
  assert.equal(state.last_status_code, 500);
  assert.equal(state.last_error, 'HTTP 500');
  assert.equal(state.next_attempt_at, START + 1000);

  // Not due yet: nothing happens.
  clock.now = START + 999;
  assert.equal(await worker.tick(), 0);
  assert.equal(requests.length, 1);

  clock.now = START + 1000;
  await worker.tick();
  state = store.deliveries.get(delivery.id);
  assert.equal(state.status, 'pending');
  assert.equal(state.next_attempt_at, START + 1000 + 2000);

  clock.now = START + 3000;
  await worker.tick();
  state = store.deliveries.get(delivery.id);
  assert.equal(state.status, 'delivered');
  assert.equal(state.attempts, 3);
  assert.equal(state.last_error, null);
  assert.deepEqual(
    requests.map((request) => request.headers['x-redeliver-attempt']),
    ['1', '2', '3'],
  );
});

test('a delivery is marked dead after the last attempt fails', async () => {
  const { store, worker, clock, requests, enqueue } = setup({ responses: [500, 500, 500] });
  const delivery = enqueue();

  for (let i = 0; i < 5; i += 1) {
    await worker.tick();
    clock.now += 60_000;
  }

  const state = store.deliveries.get(delivery.id);
  assert.equal(state.status, 'dead');
  assert.equal(state.attempts, 3);
  assert.equal(requests.length, 3);
});

test('network errors and timeouts count as failures', async () => {
  const refused = new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
  const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  const { store, worker, clock, enqueue } = setup({ responses: [refused, timeout] });
  const delivery = enqueue();

  await worker.tick();
  let state = store.deliveries.get(delivery.id);
  assert.equal(state.status, 'pending');
  assert.equal(state.last_status_code, null);
  assert.equal(state.last_error, 'ECONNREFUSED');

  clock.now += 60_000;
  await worker.tick();
  state = store.deliveries.get(delivery.id);
  assert.match(state.last_error, /^timed out after \d+ ms$/);
});

test('every attempt is recorded', async () => {
  const { store, worker, clock, enqueue } = setup({ responses: [500, 200] });
  const delivery = enqueue();

  await worker.tick();
  clock.now += 5000;
  await worker.tick();

  const attempts = store.deliveries.listAttempts(delivery.id);
  assert.deepEqual(
    attempts.map(({ attempt, status_code, error }) => ({ attempt, status_code, error })),
    [
      { attempt: 1, status_code: 500, error: 'HTTP 500' },
      { attempt: 2, status_code: 200, error: null },
    ],
  );
  assert.equal(attempts[1].attempted_at, START + 5000);
});

test('a delivery deleted while its request is in flight is ignored', async () => {
  const ctx = setup({
    responses: [
      () => {
        // Deleting the source cascades to its events and deliveries.
        ctx.store.sources.remove(ctx.source.id);
        return new Response(null, { status: 200 });
      },
    ],
  });
  const delivery = ctx.enqueue();

  assert.equal(await ctx.worker.tick(), 1);
  assert.equal(ctx.requests.length, 1);
  assert.equal(ctx.store.deliveries.get(delivery.id), undefined);
});

test('Retry-After pushes the next attempt back, up to the backoff cap', async () => {
  const tooManyRequests = (retryAfter) =>
    new Response(null, { status: 429, headers: { 'retry-after': retryAfter } });
  const { store, worker, clock, enqueue } = setup({
    config: { maxAttempts: 5 },
    responses: [tooManyRequests('30'), tooManyRequests('0'), tooManyRequests('86400')],
  });
  const delivery = enqueue();

  // Longer than the 1 s backoff: the header wins.
  await worker.tick();
  assert.equal(store.deliveries.get(delivery.id).next_attempt_at, START + 30_000);

  // Shorter than the 2 s backoff: the backoff wins.
  clock.now = START + 30_000;
  await worker.tick();
  assert.equal(store.deliveries.get(delivery.id).next_attempt_at, clock.now + 2000);

  // A day is beyond the 60 s cap.
  clock.now += 2000;
  await worker.tick();
  assert.equal(store.deliveries.get(delivery.id).next_attempt_at, clock.now + 60_000);
});

test('redirects are treated as failures', async () => {
  const { store, worker, enqueue } = setup({ responses: [302] });
  const delivery = enqueue();
  await worker.tick();
  assert.equal(store.deliveries.get(delivery.id).last_error, 'HTTP 302');
});

test('one batch takes at most workerConcurrency deliveries', async () => {
  const { worker, requests, enqueue } = setup({ config: { workerConcurrency: 2 } });
  enqueue('1');
  enqueue('2');
  enqueue('3');

  assert.equal(await worker.tick(), 2);
  assert.equal(await worker.tick(), 1);
  assert.equal(await worker.tick(), 0);
  assert.deepEqual(
    requests.map((request) => request.body.toString()),
    ['1', '2', '3'],
  );
});

test('deliveries for a paused destination wait until it is resumed', async () => {
  const { store, worker, requests, destination, enqueue } = setup();
  const delivery = enqueue();
  store.destinations.update(destination.id, { enabled: false });

  assert.equal(await worker.tick(), 0);
  assert.equal(store.deliveries.get(delivery.id).status, 'pending');

  store.destinations.update(destination.id, { enabled: true });
  assert.equal(await worker.tick(), 1);
  assert.equal(requests.length, 1);
});

test('a failing destination does not affect others in the same batch', async () => {
  const { store, worker, source, enqueue } = setup({ responses: [500, 200] });
  const other = store.destinations.create({ sourceId: source.id, url: 'http://other.test/hook' });
  const failing = enqueue('a');
  const healthy = enqueue('b', other);

  await worker.tick();
  assert.equal(store.deliveries.get(failing.id).status, 'pending');
  assert.equal(store.deliveries.get(healthy.id).status, 'delivered');
});

test('deliveries left in_progress by a crash are picked up on start', async () => {
  const { store, worker, requests, enqueue } = setup({ config: { workerPollMs: 5 } });
  const delivery = enqueue();

  // Simulate a crash: the delivery was claimed, then the process died.
  store.deliveries.claimDue(START, 10);
  assert.equal(store.deliveries.get(delivery.id).status, 'in_progress');
  assert.equal(await worker.tick(), 0);

  worker.start();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await worker.stop();

  const state = store.deliveries.get(delivery.id);
  assert.equal(state.status, 'delivered');
  assert.equal(state.attempts, 2);
  assert.equal(requests.length, 1);
});

test('start and stop run the loop against real timers', async () => {
  const { store, worker, enqueue } = setup({ config: { workerPollMs: 5 } });
  const delivery = enqueue();

  worker.start();
  worker.start(); // second call is a no-op
  await new Promise((resolve) => setTimeout(resolve, 50));
  await worker.stop();

  assert.equal(store.deliveries.get(delivery.id).status, 'delivered');
});
