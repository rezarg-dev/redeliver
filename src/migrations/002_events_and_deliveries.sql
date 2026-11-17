CREATE TABLE events (
  id              TEXT PRIMARY KEY,
  source_id       TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  idempotency_key TEXT,
  content_type    TEXT,
  headers         TEXT NOT NULL,
  body            BLOB NOT NULL,
  received_at     INTEGER NOT NULL
);

CREATE INDEX events_by_source_time ON events(source_id, received_at);
CREATE INDEX events_by_time ON events(received_at);

-- One row per (event, destination). The worker moves a delivery through
-- pending -> in_progress -> delivered, or back to pending for a retry,
-- or to dead once it runs out of attempts.
CREATE TABLE deliveries (
  id               TEXT PRIMARY KEY,
  event_id         TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  destination_id   TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'in_progress', 'delivered', 'dead')),
  attempts         INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  INTEGER NOT NULL,
  last_status_code INTEGER,
  last_error       TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE INDEX deliveries_due ON deliveries(status, next_attempt_at);
CREATE INDEX deliveries_by_event ON deliveries(event_id);
