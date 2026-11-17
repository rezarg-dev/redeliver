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

  return {
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
