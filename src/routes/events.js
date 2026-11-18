import { isUtf8 } from 'node:buffer';

import { notFound } from '../errors.js';
import { pageQuery, paginate } from '../pagination.js';
import { presentDelivery } from './deliveries.js';

const listSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: { ...pageQuery, source_id: { type: 'string' } },
  },
};

function present(event) {
  return {
    id: event.id,
    source_id: event.source_id,
    idempotency_key: event.idempotency_key,
    content_type: event.content_type,
    size: event.size ?? event.body.length,
    received_at: new Date(event.received_at).toISOString(),
  };
}

// JSON cannot carry raw bytes. Text bodies are returned as they are,
// anything else as base64, with a field that says which one it is.
function presentBody(body) {
  return isUtf8(body)
    ? { body: body.toString('utf8'), body_encoding: 'utf8' }
    : { body: body.toString('base64'), body_encoding: 'base64' };
}

export async function eventsRoutes(app, { store }) {
  app.get('/events', { schema: listSchema }, async (request) => {
    const { limit, cursor = null, source_id: sourceId = null } = request.query;
    return paginate({
      limit,
      present,
      fetchRows: (count) => store.events.list({ sourceId, cursor, limit: count }),
    });
  });

  app.get('/events/:id', async (request) => {
    const event = store.events.get(request.params.id);
    if (!event) throw notFound('Event');

    return {
      ...present(event),
      headers: JSON.parse(event.headers),
      ...presentBody(event.body),
      deliveries: store.deliveries.listByEvent(event.id).map(presentDelivery),
    };
  });

  // Sends a stored event again to every destination that is enabled now,
  // including ones added after the event first came in.
  app.post('/events/:id/replay', async (request, reply) => {
    const event = store.events.get(request.params.id);
    if (!event) throw notFound('Event');

    const deliveries = store.transaction(() =>
      store.destinations
        .listEnabledBySource(event.source_id)
        .map((destination) =>
          store.deliveries.enqueue({ eventId: event.id, destinationId: destination.id }),
        ),
    );

    return reply.code(202).send({ id: event.id, deliveries: deliveries.map(presentDelivery) });
  });
}
