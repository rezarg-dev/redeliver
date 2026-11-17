import { newId } from '../ids.js';

export function eventsStore(db) {
  const insert = db.prepare(
    `INSERT INTO events (id, source_id, content_type, headers, body, received_at)
     VALUES (@id, @source_id, @content_type, @headers, @body, @received_at)`,
  );
  const selectById = db.prepare('SELECT * FROM events WHERE id = ?');

  return {
    create({ sourceId, contentType = null, headers, body }) {
      const event = {
        id: newId('evt'),
        source_id: sourceId,
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
  };
}
