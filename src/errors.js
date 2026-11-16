export class HttpError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function notFound(what) {
  return new HttpError(404, 'not_found', `${what} not found`);
}

const CODES_BY_STATUS = {
  400: 'invalid_request',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
};

/** Every error leaves the API as { error: <code>, message: <text> }. */
export function errorHandler(err, request, reply) {
  const status = err.statusCode ?? 500;

  if (status >= 500) {
    request.log.error(err);
    return reply.code(500).send({ error: 'internal_error', message: 'Something went wrong' });
  }

  const code = err instanceof HttpError ? err.code : (CODES_BY_STATUS[status] ?? 'bad_request');
  return reply.code(status).send({ error: code, message: err.message });
}

export function notFoundHandler(request, reply) {
  return reply
    .code(404)
    .send({ error: 'not_found', message: `No route for ${request.method} ${request.url}` });
}
