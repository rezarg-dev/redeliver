-- A sender that retries (because our 202 got lost on the way back) must not
-- cause a second delivery. Keys are scoped to a source, and events without
-- a key are never treated as duplicates.
CREATE UNIQUE INDEX events_idempotency
  ON events(source_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
