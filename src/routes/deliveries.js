import { HttpError, notFound } from '../errors.js';
import { pageQuery, paginate } from '../pagination.js';

const STATUSES = ['pending', 'in_progress', 'delivered', 'dead'];

const listSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ...pageQuery,
      status: { type: 'string', enum: STATUSES },
      event_id: { type: 'string' },
    },
  },
};

const iso = (timestamp) => new Date(timestamp).toISOString();

export function presentDelivery(delivery) {
  return {
    id: delivery.id,
    event_id: delivery.event_id,
    destination_id: delivery.destination_id,
    status: delivery.status,
    attempts: delivery.attempts,
    // Only meaningful while the delivery is still waiting for its turn.
    next_attempt_at: delivery.status === 'pending' ? iso(delivery.next_attempt_at) : null,
    last_status_code: delivery.last_status_code,
    last_error: delivery.last_error,
    created_at: iso(delivery.created_at),
    updated_at: iso(delivery.updated_at),
  };
}

function presentAttempt(attempt) {
  return {
    attempt: attempt.attempt,
    status_code: attempt.status_code,
    error: attempt.error,
    duration_ms: attempt.duration_ms,
    attempted_at: iso(attempt.attempted_at),
  };
}

export async function deliveriesRoutes(app, { store }) {
  app.get('/deliveries', { schema: listSchema }, async (request) => {
    const { limit, cursor = null, status = null, event_id: eventId = null } = request.query;
    return paginate({
      limit,
      present: presentDelivery,
      fetchRows: (count) => store.deliveries.list({ status, eventId, cursor, limit: count }),
    });
  });

  app.get('/deliveries/:id', async (request) => {
    const delivery = store.deliveries.get(request.params.id);
    if (!delivery) throw notFound('Delivery');

    return {
      ...presentDelivery(delivery),
      history: store.deliveries.listAttempts(delivery.id).map(presentAttempt),
    };
  });

  app.post('/deliveries/:id/retry', async (request) => {
    const { id } = request.params;
    const delivery = store.deliveries.get(id);
    if (!delivery) throw notFound('Delivery');

    if (!store.deliveries.retryNow(id, Date.now())) {
      throw new HttpError(
        409,
        'conflict',
        `Delivery is ${delivery.status} and cannot be retried. Replay the event to send it again.`,
      );
    }
    return presentDelivery(store.deliveries.get(id));
  });
}
