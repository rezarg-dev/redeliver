import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  migrate(db);
  return db;
}

/**
 * Applies every migration file newer than the schema version stored in
 * SQLite's user_version pragma. Files are named NNN_description.sql and
 * each one runs in its own transaction.
 */
export function migrate(db) {
  const current = db.pragma('user_version', { simple: true });
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();

  for (const file of files) {
    const version = Number.parseInt(file, 10);
    if (version <= current) continue;

    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${version}`);
    })();
  }
}
