const BLOCKED_PREFIXES = ['x-forwarded-', 'x-redeliver-'];
const BLOCKED = new Set(['x-real-ip']);

/**
 * Picks the incoming headers that are stored with an event and sent on to
 * destinations. Only custom "x-" headers qualify (X-GitHub-Event and
 * friends). Authorization, cookies and proxy headers never leave the relay,
 * and x-redeliver-* is reserved for the headers we add ourselves.
 */
export function forwardableHeaders(headers) {
  const result = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!name.startsWith('x-')) continue;
    if (BLOCKED.has(name) || BLOCKED_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    if (typeof value !== 'string') continue;
    result[name] = value;
  }
  return result;
}
