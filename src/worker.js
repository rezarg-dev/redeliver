import pkg from '../package.json' with { type: 'json' };
import { parseRetryAfter, retryDelay } from './backoff.js';
import { sign } from './signature.js';

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

/**
 * Background loop that sends pending deliveries.
 *
 * `fetch`, `now` and `random` can be replaced, which is how the tests run
 * the worker without a network or real waiting.
 */
export function createWorker({
  store,
  config,
  metrics = null,
  logger = silentLogger,
  fetch = globalThis.fetch,
  now = Date.now,
  random = Math.random,
}) {
  let running = false;
  let timer = null;
  let inFlight = Promise.resolve(0);

  function buildHeaders(job) {
    const headers = {
      ...JSON.parse(job.headers),
      'user-agent': `redeliver/${pkg.version}`,
      'x-redeliver-event': job.event_id,
      'x-redeliver-delivery': job.id,
      'x-redeliver-attempt': String(job.attempts),
    };
    if (job.content_type) headers['content-type'] = job.content_type;
    if (job.secret) headers['x-redeliver-signature'] = `sha256=${sign(job.secret, job.body)}`;
    return headers;
  }

  /** Sends one request. Never throws: failures come back as { error }. */
  async function send(job) {
    try {
      const response = await fetch(job.url, {
        method: 'POST',
        headers: buildHeaders(job),
        body: job.body,
        // A redirect usually means the destination URL is wrong or outdated.
        // Following it silently would hide that, so 3xx counts as a failure.
        redirect: 'manual',
        signal: AbortSignal.timeout(config.deliveryTimeoutMs),
      });
      // We only care about the status. Discard the body so the connection
      // can be reused.
      await response.body?.cancel();

      return {
        statusCode: response.status,
        error: response.status >= 200 && response.status < 300 ? null : `HTTP ${response.status}`,
        retryAfterMs: parseRetryAfter(response.headers.get('retry-after'), now()),
      };
    } catch (err) {
      const error =
        err.name === 'TimeoutError'
          ? `timed out after ${config.deliveryTimeoutMs} ms`
          : (err.cause?.code ?? err.message);
      return { statusCode: null, error, retryAfterMs: null };
    }
  }

  async function attempt(job) {
    const startedAt = now();
    const { statusCode, error, retryAfterMs } = await send(job);
    const finishedAt = now();

    // The delivery can disappear while the request is in the air (its
    // source or destination was deleted). Nothing left to update then.
    if (!store.deliveries.get(job.id)) return;

    store.deliveries.recordAttempt({
      deliveryId: job.id,
      attempt: job.attempts,
      statusCode,
      error,
      durationMs: finishedAt - startedAt,
      at: startedAt,
    });

    if (error === null) {
      store.deliveries.markDelivered(job.id, { statusCode, now: finishedAt });
      metrics?.deliveryAttempts.inc({ outcome: 'delivered' });
      logger.info({ delivery: job.id, attempt: job.attempts, statusCode }, 'delivered');
      return;
    }

    if (job.attempts >= config.maxAttempts) {
      store.deliveries.markDead(job.id, { statusCode, error, now: finishedAt });
      metrics?.deliveryAttempts.inc({ outcome: 'dead' });
      logger.warn({ delivery: job.id, attempts: job.attempts, error }, 'giving up on delivery');
      return;
    }

    const backoff = retryDelay(job.attempts, {
      baseMs: config.backoffBaseMs,
      maxMs: config.backoffMaxMs,
      random,
    });
    // If the destination tells us when to come back (typically with a 429
    // or 503), wait at least that long, but never beyond our own cap.
    const delay = Math.min(config.backoffMaxMs, Math.max(backoff, retryAfterMs ?? 0));
    store.deliveries.markForRetry(job.id, {
      statusCode,
      error,
      nextAttemptAt: finishedAt + delay,
      now: finishedAt,
    });
    metrics?.deliveryAttempts.inc({ outcome: 'retry' });
    logger.info({ delivery: job.id, attempt: job.attempts, error, retryInMs: delay }, 'delivery failed');
  }

  /** Runs one batch and resolves with the number of deliveries it handled. */
  async function tick() {
    const jobs = store.deliveries.claimDue(now(), config.workerConcurrency);
    await Promise.all(jobs.map(attempt));
    return jobs.length;
  }

  async function loop() {
    if (!running) return;

    let handled = 0;
    try {
      inFlight = tick();
      handled = await inFlight;
    } catch (err) {
      logger.error(err, 'worker tick failed');
    }

    if (!running) return;
    // A full batch suggests there is more waiting, so go again right away.
    const delay = handled === config.workerConcurrency ? 0 : config.workerPollMs;
    timer = setTimeout(loop, delay);
  }

  return {
    tick,

    start() {
      if (running) return;
      running = true;

      const recovered = store.deliveries.recoverInterrupted(now());
      if (recovered > 0) {
        logger.warn({ recovered }, 'requeued deliveries interrupted by the last shutdown');
      }

      timer = setTimeout(loop, 0);
    },

    /** Stops polling and waits for requests that are already on their way. */
    async stop() {
      running = false;
      clearTimeout(timer);
      await inFlight.catch(() => {});
    },
  };
}
