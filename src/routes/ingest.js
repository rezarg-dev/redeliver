import { HttpError, notFound } from '../errors.js';
import { forwardableHeaders } from '../headers.js';
import { idempotencyHeader, verifySignature } from '../signature.js';

const MAX_KEY_LENGTH = 255;

// An explicit Idempotency-Key wins. Otherwise fall back to the provider's
// own delivery id, if the source's scheme defines one.
function readIdempotencyKey(headers, scheme) {
  const providerHeader = idempotencyHeader(scheme);
  const key = headers['idempotency-key'] ?? (providerHeader ? headers[providerHeader] : undefined);
  if (key === undefined || key === '') return null;
  if (typeof key !== 'string' || key.length > MAX_KEY_LENGTH) {
    throw new HttpError(400, 'invalid_request', 'Idempotency key must be a single value of at most 255 characters');
  }
  return key;
}

export async function ingestRoutes(app, { store }) {
  // Signatures are computed over the exact bytes that were sent, so this
  // scope never parses bodies: every content type arrives as a Buffer.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (request, body, done) => done(null, body));

  app.post('/in/:sourceId', async (request, reply) => {
    const source = store.sources.get(request.params.sourceId);
    if (!source) throw notFound('Source');

    const body = request.body ?? Buffer.alloc(0);
    if (!verifySignature(source.scheme, source.secret, request.headers, body)) {
      throw new HttpError(401, 'invalid_signature', 'Signature is missing or does not match');
    }

    const idempotencyKey = readIdempotencyKey(request.headers, source.scheme);

    // The event and its deliveries are written together. If the process
    // dies in between, we either have both or the sender gets an error
    // and retries. The duplicate check sits inside the same transaction
    // so two identical requests cannot both pass it.
    const result = store.transaction(() => {
      if (idempotencyKey !== null) {
        const existing = store.events.findByIdempotencyKey(source.id, idempotencyKey);
        if (existing) return { id: existing.id, duplicate: true };
      }

      const event = store.events.create({
        sourceId: source.id,
        idempotencyKey,
        contentType: request.headers['content-type'] ?? null,
        headers: forwardableHeaders(request.headers),
        body,
      });
      const destinations = store.destinations.listEnabledBySource(source.id);
      for (const destination of destinations) {
        store.deliveries.enqueue({ eventId: event.id, destinationId: destination.id });
      }
      return { id: event.id, deliveries: destinations.length };
    });

    return reply.code(result.duplicate ? 200 : 202).send(result);
  });
}
