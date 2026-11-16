import assert from 'node:assert/strict';
import { test } from 'node:test';

import { migrate, openDatabase } from '../src/db.js';
import { createStore } from '../src/store/index.js';

test('migrations bring a new database to the latest version', () => {
  const db = openDatabase(':memory:');
  assert.ok(db.pragma('user_version', { simple: true }) >= 1);
});

test('running migrations twice changes nothing', () => {
  const db = openDatabase(':memory:');
  const before = db.pragma('user_version', { simple: true });
  migrate(db);
  assert.equal(db.pragma('user_version', { simple: true }), before);
});

test('deleting a source removes its destinations', () => {
  const db = openDatabase(':memory:');
  const store = createStore(db);
  const source = store.sources.create({ name: 'shop' });
  db.prepare(
    'INSERT INTO destinations (id, source_id, url, created_at) VALUES (?, ?, ?, ?)',
  ).run('dst_1', source.id, 'http://localhost:9000/hook', Date.now());

  store.sources.remove(source.id);

  const left = db.prepare('SELECT COUNT(*) FROM destinations').pluck().get();
  assert.equal(left, 0);
});
