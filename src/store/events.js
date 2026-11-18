import { newId } from '../ids.js';

export function eventsStore(db) {
  const insert = db.prepare(
    `INSERT INTO events (id, source_id, idempotency_key, content_type, headers, body, received_at)
     VALUES (@id, @source_id, @idempotency_key, @content_type, @headers, @body, @received_at)`,
  );
  const selectById = db.prepare('SELECT * FROM events WHERE id = ?');
  const selectByKey = db.prepare(
    'SELECT * FROM events WHERE source_id = ? AND idempotency_key = ?',
  );

  // rowid grows with every insert, which makes it a gap-free pagination
  // cursor even when several events share the same millisecond. Bodies are
  // left out of the list; only their size is reported.
  const selectPage = db.prepare(
    `SELECT rowid AS seq, id, source_id, idempotency_key, content_type,
            length(body) AS size, received_at
       FROM events
      WHERE (@source_id IS NULL OR source_id = @source_id)
        AND (@cursor IS NULL OR rowid < @cursor)
      ORDER BY rowid DESC
      LIMIT @limit`,
  );

  return {
    /** Newest first. Pass the `seq` of the last row as `cursor` for the next page. */
    list({ sourceId = null, cursor = null, limit = 50 } = {}) {
      return selectPage.all({ source_id: sourceId, cursor, limit });
    },

    create({ sourceId, idempotencyKey = null, contentType = null, headers, body }) {
      const event = {
        id: newId('evt'),
        source_id: sourceId,
        idempotency_key: idempotencyKey,
        content_type: contentType,
        headers: JSON.stringify(headers),
        body,
        received_at: Date.now(),
      };
      insert.run(event);
      return event;
    },

    get(id) {
      return selectById.get(id);
    },

    findByIdempotencyKey(sourceId, key) {
      return selectByKey.get(sourceId, key);
    },
  };
}
