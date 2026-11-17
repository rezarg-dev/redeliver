import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseRetryAfter, retryDelay } from '../src/backoff.js';

const options = { baseMs: 1000, maxMs: 60_000 };
const lowest = { ...options, random: () => 0 };
const highest = { ...options, random: () => 1 };

test('delay window doubles with every attempt', () => {
  assert.equal(retryDelay(1, lowest), 500);
  assert.equal(retryDelay(1, highest), 1000);
  assert.equal(retryDelay(2, highest), 2000);
  assert.equal(retryDelay(3, highest), 4000);
  assert.equal(retryDelay(4, lowest), 4000);
});

test('delay never exceeds the cap', () => {
  assert.equal(retryDelay(7, highest), 60_000);
  assert.equal(retryDelay(50, highest), 60_000);
  assert.equal(retryDelay(5000, highest), 60_000);
});

test('delay stays inside the upper half of the window', () => {
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const ceiling = Math.min(options.maxMs, options.baseMs * 2 ** (attempt - 1));
    for (let i = 0; i < 50; i += 1) {
      const delay = retryDelay(attempt, options);
      assert.ok(delay >= ceiling / 2 && delay <= ceiling, `attempt ${attempt}: ${delay}`);
    }
  }
});

test('attempt numbers below 1 behave like the first attempt', () => {
  assert.equal(retryDelay(0, highest), 1000);
  assert.equal(retryDelay(-3, highest), 1000);
});

test('Retry-After in seconds', () => {
  assert.equal(parseRetryAfter('30'), 30_000);
  assert.equal(parseRetryAfter(' 5 '), 5000);
  assert.equal(parseRetryAfter('0'), 0);
});

test('Retry-After as an HTTP date', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  assert.equal(parseRetryAfter('Thu, 01 Jan 2026 00:02:00 GMT', now), 120_000);
  assert.equal(parseRetryAfter('Wed, 31 Dec 2025 23:00:00 GMT', now), 0);
});

test('missing or broken Retry-After yields null', () => {
  assert.equal(parseRetryAfter(null), null);
  assert.equal(parseRetryAfter(undefined), null);
  assert.equal(parseRetryAfter(''), null);
  assert.equal(parseRetryAfter('soon'), null);
  assert.equal(parseRetryAfter('-5'), null);
});
