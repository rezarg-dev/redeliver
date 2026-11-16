import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (value) => createHash('sha256').update(value).digest();

/**
 * Constant-time string comparison. Hashing both sides first gives buffers
 * of equal length, so the comparison does not leak the token length.
 */
export function tokensMatch(given, expected) {
  return timingSafeEqual(digest(given), digest(expected));
}

/** onRequest hook that only lets requests with the admin bearer token pass. */
export function requireAdmin(adminToken) {
  return async function checkAdminToken(request, reply) {
    const header = request.headers.authorization ?? '';
    const [kind, token] = header.split(' ');

    if (kind !== 'Bearer' || !token || !tokensMatch(token, adminToken)) {
      return reply
        .code(401)
        .header('www-authenticate', 'Bearer')
        .send({ error: 'unauthorized', message: 'Missing or invalid admin token' });
    }
  };
}
