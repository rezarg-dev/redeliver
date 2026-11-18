import Fastify from 'fastify';

import { requireAdmin } from './auth.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { deliveriesRoutes } from './routes/deliveries.js';
import { destinationsRoutes } from './routes/destinations.js';
import { healthRoutes } from './routes/health.js';
import { ingestRoutes } from './routes/ingest.js';
import { sourcesRoutes } from './routes/sources.js';

export function buildApp({ config, store, logger = true }) {
  const app = Fastify({
    logger,
    bodyLimit: config.maxBodyBytes,
    // Fastify strips unknown body properties by default. Rejecting them is
    // friendlier: a typo in a field name becomes a 400 instead of a no-op.
    ajv: { customOptions: { removeAdditional: false } },
  });

  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  app.register(healthRoutes, { store });
  app.register(ingestRoutes, { store });

  // Everything under /api is the admin API and sits behind the bearer token.
  app.register(
    async (api) => {
      api.addHook('onRequest', requireAdmin(config.adminToken));
      api.register(sourcesRoutes, { store });
      api.register(destinationsRoutes, { store });
      api.register(deliveriesRoutes, { store });
    },
    { prefix: '/api' },
  );

  return app;
}
