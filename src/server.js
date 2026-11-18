import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { createMetrics } from './metrics.js';
import { createStore } from './store/index.js';
import { createWorker } from './worker.js';

const SHUTDOWN_TIMEOUT_MS = 15_000;

function readConfig() {
  try {
    return loadConfig();
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    console.error(err.message);
    process.exit(1);
  }
}

const config = readConfig();
const db = openDatabase(config.databasePath);
const store = createStore(db);
const metrics = createMetrics(store);
const app = buildApp({ config, store, metrics, logger: { level: config.logLevel } });
const worker = createWorker({ store, config, metrics, logger: app.log });

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');

  // Safety net in case a connection or a delivery refuses to finish.
  const forceExit = setTimeout(() => {
    app.log.error('shutdown timed out, exiting anyway');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    // Order matters: stop taking new webhooks, let running deliveries
    // finish and record their result, and only then close the database.
    await app.close();
    await worker.stop();
    db.close();
    process.exit(0);
  } catch (err) {
    app.log.error(err, 'error during shutdown');
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

try {
  await app.listen({ host: config.host, port: config.port });
  worker.start();
} catch (err) {
  app.log.error(err, 'failed to start');
  db.close();
  process.exit(1);
}
