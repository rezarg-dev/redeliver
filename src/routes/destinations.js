import { HttpError, notFound } from '../errors.js';

const url = { type: 'string', minLength: 1, maxLength: 2048 };
const secret = { type: ['string', 'null'], minLength: 8, maxLength: 256 };

const createSchema = {
  body: {
    type: 'object',
    required: ['url'],
    additionalProperties: false,
    properties: { url, secret },
  },
};

const updateSchema = {
  body: {
    type: 'object',
    minProperties: 1,
    additionalProperties: false,
    properties: { url, secret, enabled: { type: 'boolean' } },
  },
};

function assertHttpUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new HttpError(400, 'invalid_request', 'url is not a valid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new HttpError(400, 'invalid_request', 'url must use http or https');
  }
}

function present(destination) {
  return {
    id: destination.id,
    source_id: destination.source_id,
    url: destination.url,
    enabled: destination.enabled === 1,
    signed: destination.secret !== null,
    created_at: new Date(destination.created_at).toISOString(),
  };
}

export async function destinationsRoutes(app, { store }) {
  app.post('/sources/:sourceId/destinations', { schema: createSchema }, async (request, reply) => {
    const source = store.sources.get(request.params.sourceId);
    if (!source) throw notFound('Source');
    assertHttpUrl(request.body.url);

    const destination = store.destinations.create({
      sourceId: source.id,
      url: request.body.url,
      secret: request.body.secret ?? null,
    });
    return reply.code(201).send(present(destination));
  });

  app.get('/sources/:sourceId/destinations', async (request) => {
    const source = store.sources.get(request.params.sourceId);
    if (!source) throw notFound('Source');
    return { data: store.destinations.listBySource(source.id).map(present) };
  });

  app.patch('/destinations/:id', { schema: updateSchema }, async (request) => {
    if (request.body.url !== undefined) assertHttpUrl(request.body.url);

    const destination = store.destinations.update(request.params.id, request.body);
    if (!destination) throw notFound('Destination');
    return present(destination);
  });

  app.delete('/destinations/:id', async (request, reply) => {
    if (!store.destinations.remove(request.params.id)) throw notFound('Destination');
    return reply.code(204).send();
  });
}
