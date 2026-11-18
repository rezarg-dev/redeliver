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

  const insertAttempt = db.prepare(
    `INSERT INTO delivery_attempts (delivery_id, attempt, status_code, error, duration_ms, attempted_at)
     VALUES (@delivery_id, @attempt, @status_code, @error, @duration_ms, @attempted_at)`,
  );
  const selectAttempts = db.prepare(
    'SELECT * FROM delivery_attempts WHERE delivery_id = ? ORDER BY id',
  );

  const releaseInProgress = db.prepare(
    `UPDATE deliveries
        SET status = 'pending', next_attempt_at = @now, updated_at = @now
      WHERE status = 'in_progress'`,
  );

  const selectPage = db.prepare(
    `SELECT rowid AS seq, *
       FROM deliveries
      WHERE (@status IS NULL OR status = @status)
        AND (@event_id IS NULL OR event_id = @event_id)
        AND (@cursor IS NULL OR rowid < @cursor)
      ORDER BY rowid DESC
      LIMIT @limit`,
  );
  const requeue = db.prepare(
    `UPDATE deliveries
        SET status = 'pending', attempts = 0, next_attempt_at = @now, updated_at = @now
      WHERE id = @id AND status IN ('pending', 'dead')`,
  );

  const countGrouped = db.prepare('SELECT status, COUNT(*) AS count FROM deliveries GROUP BY status');

  return {
    /** Number of deliveries per status. States with no rows are reported as 0. */
    countByStatus() {
      const counts = { pending: 0, in_progress: 0, delivered: 0, dead: 0 };
      for (const { status, count } of countGrouped.all()) counts[status] = count;
      return counts;
    },

    /** Newest first. Pass the `seq` of the last row as `cursor` for the next page. */
    list({ status = null, eventId = null, cursor = null, limit = 50 } = {}) {
      return selectPage.all({ status, event_id: eventId, cursor, limit });
    },

    /**
     * Makes a dead or waiting delivery due immediately, with a fresh attempt
     * budget. Returns false if the delivery is in a state that cannot be
     * retried (already delivered, or being sent right now).
     */
    retryNow(id, now) {
      return requeue.run({ id, now }).changes > 0;
    },

    /**
     * Puts deliveries that were mid-flight when the process stopped back in
     * the queue. We cannot know whether those requests arrived, so they are
     * sent again: at-least-once delivery. Returns how many were released.
     */
    recoverInterrupted(now) {
      return releaseInProgress.run({ now }).changes;
    },

    recordAttempt({ deliveryId, attempt, statusCode, error, durationMs, at }) {
      insertAttempt.run({
        delivery_id: deliveryId,
        attempt,
        status_code: statusCode,
        error,
        duration_ms: durationMs,
        attempted_at: at,
      });
    },

    listAttempts(deliveryId) {
      return selectAttempts.all(deliveryId);
    },

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
