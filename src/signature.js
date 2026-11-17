import { createHmac, timingSafeEqual } from 'node:crypto';

/** Hex encoded HMAC-SHA256 of the raw request body. */
export function sign(secret, body) {
  return createHmac('sha256', secret).update(body).digest('hex');
}

function matches(given, expected) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * How each scheme proves that a webhook is authentic.
 *   header  - where the sender puts the signature
 *   verify  - checks the header value against the raw body
 */
const schemes = {
  none: {
    header: null,
    verify: () => true,
  },

  // Generic scheme: X-Signature carries the hex digest, the "sha256="
  // prefix is optional.
  'hmac-sha256': {
    header: 'x-signature',
    verify(secret, given, body) {
      const digest = given.startsWith('sha256=') ? given.slice(7) : given;
      return matches(digest.toLowerCase(), sign(secret, body));
    },
  },

  // GitHub: X-Hub-Signature-256 is always "sha256=<hex>", and every
  // delivery has a GUID that GitHub reuses when it redelivers.
  github: {
    header: 'x-hub-signature-256',
    idempotencyHeader: 'x-github-delivery',
    verify(secret, given, body) {
      if (!given.startsWith('sha256=')) return false;
      return matches(given.slice(7), sign(secret, body));
    },
  },
};

/** Header a scheme uses to identify redeliveries, if it has one. */
export function idempotencyHeader(schemeName) {
  return schemes[schemeName]?.idempotencyHeader ?? null;
}

export const SCHEMES = Object.keys(schemes);

export function verifySignature(schemeName, secret, headers, body) {
  const scheme = schemes[schemeName];
  if (!scheme) return false;
  if (scheme.header === null) return true;

  const given = headers[scheme.header];
  if (typeof given !== 'string' || given === '') return false;
  return scheme.verify(secret, given, body);
}
