import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

// Extended SQLite result code for a violated UNIQUE constraint.
const SQLITE_CONSTRAINT_UNIQUE = 2067;

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');

  migrate(db);
  return db;
}

export function schemaVersion(db) {
  return db.prepare('PRAGMA user_version').get().user_version;
}

/**
 * Applies every migration file newer than the schema version stored in
 * SQLite's user_version pragma. Files are named NNN_description.sql and
 * each one runs in its own transaction.
 */
export function migrate(db) {
  const current = schemaVersion(db);
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();

  for (const file of files) {
    const version = Number.parseInt(file, 10);
    if (version <= current) continue;

    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    transaction(db, () => {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${version}`);
    });
  }
}

/**
 * Runs `fn` inside a transaction and returns its result. Everything `fn`
 * wrote is rolled back if it throws. Not reentrant: do not nest calls.
 */
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function isUniqueViolation(err) {
  return err?.errcode === SQLITE_CONSTRAINT_UNIQUE;
}

/** node:sqlite returns BLOBs as Uint8Array. This gives a Buffer over the same memory. */
export function toBuffer(bytes) {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
