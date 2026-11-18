import assert from 'node:assert/strict';
import { test } from 'node:test';

import { migrate, openDatabase, schemaVersion, transaction } from '../src/db.js';
import { createStore } from '../src/store/index.js';

test('migrations bring a new database to the latest version', () => {
  const db = openDatabase(':memory:');
  assert.ok(schemaVersion(db) >= 1);
});

test('running migrations twice changes nothing', () => {
  const db = openDatabase(':memory:');
  const before = schemaVersion(db);
  migrate(db);
  assert.equal(schemaVersion(db), before);
});

test('deleting a source removes its destinations', () => {
  const db = openDatabase(':memory:');
  const store = createStore(db);
  const source = store.sources.create({ name: 'shop' });
  db.prepare(
    'INSERT INTO destinations (id, source_id, url, created_at) VALUES (?, ?, ?, ?)',
  ).run('dst_1', source.id, 'http://localhost:9000/hook', Date.now());

  store.sources.remove(source.id);

  const { left } = db.prepare('SELECT COUNT(*) AS left FROM destinations').get();
  assert.equal(left, 0);
});

test('a failed transaction leaves nothing behind', () => {
  const db = openDatabase(':memory:');
  const store = createStore(db);

  assert.throws(
    () =>
      transaction(db, () => {
        store.sources.create({ name: 'shop' });
        throw new Error('boom');
      }),
    /boom/,
  );
  assert.equal(store.sources.list().length, 0);

  // The connection is usable again afterwards.
  assert.equal(transaction(db, () => store.sources.create({ name: 'shop' }).name), 'shop');
});
