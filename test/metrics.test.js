import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRegistry } from '../src/metrics.js';
import { createWorker } from '../src/worker.js';
import { createTestApp } from './support/helpers.js';

test('registry renders counters and gauges in Prometheus text format', () => {
  const registry = createRegistry();
  const requests = registry.counter('requests_total', 'Requests handled.');
  registry.gauge('queue_size', 'Items waiting.', () => [{ value: 7 }]);

  requests.inc({ method: 'GET' });
  requests.inc({ method: 'GET' });
  requests.inc({ method: 'POST' }, 5);

  assert.equal(
    registry.render(),
    [
      '# HELP requests_total Requests handled.',
      '# TYPE requests_total counter',
      'requests_total{method="GET"} 2',
      'requests_total{method="POST"} 5',
      '# HELP queue_size Items waiting.',
      '# TYPE queue_size gauge',
      'queue_size 7',
      '',
    ].join('\n'),
  );
});

test('label values are escaped', () => {
  const registry = createRegistry();
  registry.counter('c', 'help').inc({ name: 'a "quoted" \\ value\nnext' });
  assert.match(registry.render(), /c\{name="a \\"quoted\\" \\\\ value\\nnext"\} 1/);
});

test('GET /metrics reflects ingest and delivery activity', async () => {
  const { app, store, config, metrics } = createTestApp();
  const source = store.sources.create({ name: 'shop', scheme: 'none' });
  store.destinations.create({ sourceId: source.id, url: 'http://localhost:9000/hook' });

  const send = (url, headers = {}) => app.inject({ method: 'POST', url, headers, payload: '{}' });
  await send(`/in/${source.id}`, { 'idempotency-key': 'k1' });
  await send(`/in/${source.id}`, { 'idempotency-key': 'k1' });
  await send(`/in/${source.id}`);
  await send('/in/src_missing');

  const responses = [500, 200];
  const worker = createWorker({
    store,
    config,
    metrics,
    fetch: async () => new Response(null, { status: responses.shift() }),
  });
  await worker.tick();

  const response = await app.inject({ method: 'GET', url: '/metrics' });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'], /^text\/plain/);

  const lines = response.body.split('\n');
  for (const expected of [
    'redeliver_events_received_total{source="shop"} 2',
    'redeliver_events_duplicate_total{source="shop"} 1',
    'redeliver_events_rejected_total{reason="unknown_source"} 1',
    'redeliver_delivery_attempts_total{outcome="retry"} 1',
    'redeliver_delivery_attempts_total{outcome="delivered"} 1',
    'redeliver_deliveries{status="pending"} 1',
    'redeliver_deliveries{status="delivered"} 1',
    'redeliver_deliveries{status="dead"} 0',
  ]) {
    assert.ok(lines.includes(expected), `missing line: ${expected}`);
  }
});
