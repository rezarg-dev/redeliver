export class ConfigError extends Error {
  constructor(problems) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

/**
 * Reads configuration from environment variables.
 * All problems are collected and reported at once, so a broken .env
 * does not have to be fixed one variable at a time.
 */
export function loadConfig(env = process.env) {
  const problems = [];

  const int = (key, fallback, min = 1) => {
    const raw = env[key];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min) {
      problems.push(`${key} must be an integer >= ${min}, got "${raw}"`);
      return fallback;
    }
    return value;
  };

  const adminToken = env.ADMIN_TOKEN ?? '';
  if (adminToken.length < 16) {
    problems.push('ADMIN_TOKEN is required and must be at least 16 characters long');
  }

  const logLevel = env.LOG_LEVEL || 'info';
  if (!LOG_LEVELS.includes(logLevel)) {
    problems.push(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}, got "${logLevel}"`);
  }

  const config = {
    host: env.HOST || '0.0.0.0',
    port: int('PORT', 3000, 0),
    logLevel,
    adminToken,
    databasePath: env.DATABASE_PATH || './data/redeliver.db',
    maxBodyBytes: int('MAX_BODY_BYTES', 256 * 1024),
    workerPollMs: int('WORKER_POLL_MS', 1000),
    workerConcurrency: int('WORKER_CONCURRENCY', 4),
    deliveryTimeoutMs: int('DELIVERY_TIMEOUT_MS', 10_000),
    maxAttempts: int('MAX_ATTEMPTS', 8),
    backoffBaseMs: int('BACKOFF_BASE_MS', 2000),
    backoffMaxMs: int('BACKOFF_MAX_MS', 60 * 60 * 1000),
  };

  if (config.backoffMaxMs < config.backoffBaseMs) {
    problems.push('BACKOFF_MAX_MS must not be smaller than BACKOFF_BASE_MS');
  }

  if (problems.length > 0) throw new ConfigError(problems);
  return Object.freeze(config);
}
