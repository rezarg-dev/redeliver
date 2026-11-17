/**
 * Delay before the next attempt, after `attempt` attempts have failed.
 *
 * Exponential backoff with "equal jitter": the delay doubles each time up
 * to `maxMs`, and the actual wait is a random point in the upper half of
 * that window. The random part spreads out retries that would otherwise
 * all hit a recovering destination at the same instant, while the fixed
 * half guarantees a minimum pause.
 *
 *   attempt 1 -> base/2 .. base
 *   attempt 2 -> base   .. 2*base
 *   attempt 3 -> 2*base .. 4*base   (and so on, capped at maxMs)
 */
export function retryDelay(attempt, { baseMs, maxMs, random = Math.random }) {
  // 2 ** 40 is already far past any sensible cap; clamping the exponent
  // keeps the multiplication well inside safe integer range.
  const exponent = Math.min(Math.max(attempt, 1) - 1, 40);
  const ceiling = Math.min(maxMs, baseMs * 2 ** exponent);
  const half = ceiling / 2;
  return Math.round(half + random() * half);
}

/**
 * Parses a Retry-After header: either a number of seconds or an HTTP date.
 * Returns the wait in milliseconds, or null if the header is absent or
 * unusable.
 */
export function parseRetryAfter(value, now = Date.now()) {
  if (typeof value !== 'string' || value.trim() === '') return null;

  const text = value.trim();
  if (/^\d+$/.test(text)) return Number(text) * 1000;

  // Date.parse is lenient and turns strings like "-5" into a date. Real
  // HTTP dates always start with a weekday name.
  if (!/^[A-Za-z]{3}/.test(text)) return null;

  const date = Date.parse(text);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - now);
}
