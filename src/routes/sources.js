import { HttpError, notFound } from '../errors.js';
import { SCHEMES } from '../signature.js';

const createSchema = {
  body: {
    type: 'object',
    required: ['name'],
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9][A-Za-z0-9 _.-]*$' },
      scheme: { type: 'string', enum: SCHEMES },
    },
  },
};

// The secret is deliberately left out. It is returned once, on creation.
function present(source) {
  return {
    id: source.id,
    name: source.name,
    scheme: source.scheme,
    ingest_path: `/in/${source.id}`,
    created_at: new Date(source.created_at).toISOString(),
  };
}

export async function sourcesRoutes(app, { store }) {
  app.post('/sources', { schema: createSchema }, async (request, reply) => {
    let source;
    try {
      source = store.sources.create(request.body);
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new HttpError(409, 'conflict', `A source named "${request.body.name}" already exists`);
      }
      throw err;
    }
    return reply.code(201).send({ ...present(source), secret: source.secret });
  });

  app.get('/sources', async () => ({ data: store.sources.list().map(present) }));

  app.get('/sources/:id', async (request) => {
    const source = store.sources.get(request.params.id);
    if (!source) throw notFound('Source');
    return present(source);
  });

  app.delete('/sources/:id', async (request, reply) => {
    if (!store.sources.remove(request.params.id)) throw notFound('Source');
    return reply.code(204).send();
  });
}
