import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { openDatabase } from '../../src/db.js';
import { createStore } from '../../src/store/index.js';

export const ADMIN_TOKEN = 'test-admin-token-0123456789';
export const auth = { authorization: `Bearer ${ADMIN_TOKEN}` };

export function testConfig(overrides = {}) {
  return { ...loadConfig({ ADMIN_TOKEN, DATABASE_PATH: ':memory:' }), ...overrides };
}

/** Fresh app on an in-memory database, so tests never share state. */
export function createTestApp(overrides) {
  const config = testConfig(overrides);
  const db = openDatabase(config.databasePath);
  const store = createStore(db);
  const app = buildApp({ config, store, logger: false });
  return { app, store, db, config };
}
