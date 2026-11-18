import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ConfigError, loadConfig } from '../src/config.js';

const ADMIN_TOKEN = 'a-long-enough-admin-token';

test('uses defaults when only the admin token is set', () => {
  const config = loadConfig({ ADMIN_TOKEN });
  assert.equal(config.port, 3000);
  assert.equal(config.maxAttempts, 12);
  assert.equal(config.databasePath, './data/redeliver.db');
});

test('reads numeric values from the environment', () => {
  const config = loadConfig({ ADMIN_TOKEN, PORT: '8080', MAX_ATTEMPTS: '3' });
  assert.equal(config.port, 8080);
  assert.equal(config.maxAttempts, 3);
});

test('treats empty strings like unset variables', () => {
  const config = loadConfig({ ADMIN_TOKEN, PORT: '' });
  assert.equal(config.port, 3000);
});

test('rejects a missing or short admin token', () => {
  assert.throws(() => loadConfig({}), ConfigError);
  assert.throws(() => loadConfig({ ADMIN_TOKEN: 'short' }), ConfigError);
});

test('reports every problem in one error', () => {
  try {
    loadConfig({ PORT: 'abc', MAX_ATTEMPTS: '0', LOG_LEVEL: 'loud' });
    assert.fail('expected loadConfig to throw');
  } catch (err) {
    assert.ok(err instanceof ConfigError);
    assert.equal(err.problems.length, 4);
  }
});

test('rejects a backoff cap below the base delay', () => {
  assert.throws(
    () => loadConfig({ ADMIN_TOKEN, BACKOFF_BASE_MS: '5000', BACKOFF_MAX_MS: '1000' }),
    /BACKOFF_MAX_MS/,
  );
});

test('returned config is frozen', () => {
  const config = loadConfig({ ADMIN_TOKEN });
  assert.throws(() => {
    config.port = 1;
  }, TypeError);
});
