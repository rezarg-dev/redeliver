import { HttpError, notFound } from '../errors.js';
import { forwardableHeaders } from '../headers.js';
import { verifySignature } from '../signature.js';

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

    // The event and its deliveries are written together. If the process
    // dies in between, we either have both or the sender gets an error
    // and retries.
    const result = store.transaction(() => {
      const event = store.events.create({
        sourceId: source.id,
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

    return reply.code(202).send(result);
  });
}
