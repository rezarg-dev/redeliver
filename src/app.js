import Fastify from 'fastify';

import { errorHandler, notFoundHandler } from './errors.js';
import { healthRoutes } from './routes/health.js';

export function buildApp({ config, store, logger = true }) {
  const app = Fastify({ logger, bodyLimit: config.maxBodyBytes });

  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  app.register(healthRoutes, { store });

  return app;
}
