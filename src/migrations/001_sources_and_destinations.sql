CREATE TABLE sources (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  scheme     TEXT NOT NULL,
  secret     TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE destinations (
  id         TEXT PRIMARY KEY,
  source_id  TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  secret     TEXT,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE INDEX destinations_by_source ON destinations(source_id);
