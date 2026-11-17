import { newId } from '../ids.js';

export function deliveriesStore(db) {
  const insert = db.prepare(
    `INSERT INTO deliveries (id, event_id, destination_id, next_attempt_at, created_at, updated_at)
     VALUES (@id, @event_id, @destination_id, @at, @at, @at)`,
  );
  const selectById = db.prepare('SELECT * FROM deliveries WHERE id = ?');
  const selectByEvent = db.prepare(
    'SELECT * FROM deliveries WHERE event_id = ? ORDER BY rowid',
  );

  return {
    enqueue({ eventId, destinationId, at = Date.now() }) {
      const delivery = { id: newId('dlv'), event_id: eventId, destination_id: destinationId, at };
      insert.run(delivery);
      return selectById.get(delivery.id);
    },

    get(id) {
      return selectById.get(id);
    },

    listByEvent(eventId) {
      return selectByEvent.all(eventId);
    },
  };
}
