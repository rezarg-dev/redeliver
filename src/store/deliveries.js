import { newId } from '../ids.js';

export function deliveriesStore(db) {
  const insert = db.prepare(
    `INSERT INTO deliveries (id, event_id, destination_id, next_attempt_at, created_at, updated_at)
     VALUES (@id, @event_id, @destination_id, @at, @at, @at)`,
  );
  const selectById = db.prepare('SELECT * FROM deliveries WHERE id = ?');
  const selectByEvent = db.prepare('SELECT * FROM deliveries WHERE event_id = ? ORDER BY rowid');

  // Deliveries of a paused destination are skipped here and simply stay
  // pending, so pausing keeps the backlog instead of dropping it.
  const selectDue = db.prepare(
    `SELECT d.id
       FROM deliveries d
       JOIN destinations t ON t.id = d.destination_id
      WHERE d.status = 'pending' AND d.next_attempt_at <= ? AND t.enabled = 1
      ORDER BY d.next_attempt_at, d.rowid
      LIMIT ?`,
  );
  const markInProgress = db.prepare(
    `UPDATE deliveries
        SET status = 'in_progress', attempts = attempts + 1, updated_at = ?
      WHERE id = ?`,
  );
  const selectJob = db.prepare(
    `SELECT d.id, d.attempts, d.event_id, d.destination_id,
            t.url, t.secret, e.content_type, e.headers, e.body
       FROM deliveries d
       JOIN destinations t ON t.id = d.destination_id
       JOIN events e ON e.id = d.event_id
      WHERE d.id = ?`,
  );
  const claimDue = db.transaction((now, limit) =>
    selectDue.all(now, limit).map(({ id }) => {
      markInProgress.run(now, id);
      return selectJob.get(id);
    }),
  );

  const finish = db.prepare(
    `UPDATE deliveries
        SET status = @status,
            next_attempt_at = COALESCE(@next_attempt_at, next_attempt_at),
            last_status_code = @status_code,
            last_error = @error,
            updated_at = @now
      WHERE id = @id`,
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

    /**
     * Atomically takes up to `limit` due deliveries, marks them in_progress
     * and counts the attempt. Returns everything needed to send them.
     */
    claimDue(now, limit) {
      return claimDue(now, limit);
    },

    markDelivered(id, { statusCode, now }) {
      finish.run({ id, status: 'delivered', next_attempt_at: null, status_code: statusCode, error: null, now });
    },

    markForRetry(id, { statusCode, error, nextAttemptAt, now }) {
      finish.run({ id, status: 'pending', next_attempt_at: nextAttemptAt, status_code: statusCode, error, now });
    },

    markDead(id, { statusCode, error, now }) {
      finish.run({ id, status: 'dead', next_attempt_at: null, status_code: statusCode, error, now });
    },
  };
}
