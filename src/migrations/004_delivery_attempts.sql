-- deliveries only remembers the latest outcome. This table keeps every
-- attempt, which is what you want to look at when a destination misbehaves.
CREATE TABLE delivery_attempts (
  id           INTEGER PRIMARY KEY,
  delivery_id  TEXT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  attempt      INTEGER NOT NULL,
  status_code  INTEGER,
  error        TEXT,
  duration_ms  INTEGER NOT NULL,
  attempted_at INTEGER NOT NULL
);

CREATE INDEX delivery_attempts_by_delivery ON delivery_attempts(delivery_id);
