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
};

export const SCHEMES = Object.keys(schemes);

export function verifySignature(schemeName, secret, headers, body) {
  const scheme = schemes[schemeName];
  if (!scheme) return false;
  if (scheme.header === null) return true;

  const given = headers[scheme.header];
  if (typeof given !== 'string' || given === '') return false;
  return scheme.verify(secret, given, body);
}
