export async function healthRoutes(app, { store }) {
  app.get('/healthz', async (request, reply) => {
    try {
      if (store.isHealthy()) return { status: 'ok' };
    } catch (err) {
      request.log.error(err, 'health check failed');
    }
    return reply.code(503).send({ status: 'unavailable' });
  });
}
