export async function metricsRoutes(app, { metrics }) {
  app.get('/metrics', async (request, reply) =>
    reply.type('text/plain; version=0.0.4; charset=utf-8').send(metrics.render()),
  );
}
