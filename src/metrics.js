// A small Prometheus text-format exporter. The service needs three
// counters and two gauges, which did not seem worth a dependency.

function escapeLabelValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function formatLabels(labels) {
  const pairs = Object.entries(labels).map(([name, value]) => `${name}="${escapeLabelValue(value)}"`);
  return pairs.length > 0 ? `{${pairs.join(',')}}` : '';
}

export function createRegistry() {
  const metrics = [];

  return {
    /** A value that only goes up. Kept in memory, so it resets on restart. */
    counter(name, help) {
      const series = new Map();
      metrics.push({ name, help, type: 'counter', collect: () => [...series] });
      return {
        inc(labels = {}, amount = 1) {
          const key = formatLabels(labels);
          series.set(key, (series.get(key) ?? 0) + amount);
        },
      };
    },

    /** A value read on demand: `read` returns [{ labels, value }] at scrape time. */
    gauge(name, help, read) {
      metrics.push({
        name,
        help,
        type: 'gauge',
        collect: () => read().map(({ labels = {}, value }) => [formatLabels(labels), value]),
      });
    },

    render() {
      const lines = [];
      for (const { name, help, type, collect } of metrics) {
        lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
        for (const [labels, value] of collect()) lines.push(`${name}${labels} ${value}`);
      }
      return `${lines.join('\n')}\n`;
    },
  };
}

export function createMetrics(store) {
  const registry = createRegistry();

  const metrics = {
    eventsReceived: registry.counter(
      'redeliver_events_received_total',
      'Webhooks accepted and stored, by source.',
    ),
    eventsDuplicate: registry.counter(
      'redeliver_events_duplicate_total',
      'Webhooks recognised as a repeat of an earlier one, by source.',
    ),
    eventsRejected: registry.counter(
      'redeliver_events_rejected_total',
      'Webhooks that were not accepted, by reason.',
    ),
    deliveryAttempts: registry.counter(
      'redeliver_delivery_attempts_total',
      'Requests sent to destinations, by outcome (delivered, retry, dead).',
    ),
    render: registry.render,
  };

  registry.gauge('redeliver_deliveries', 'Deliveries currently in each state.', () =>
    Object.entries(store.deliveries.countByStatus()).map(([status, value]) => ({
      labels: { status },
      value,
    })),
  );
  registry.gauge('redeliver_uptime_seconds', 'Seconds since the process started.', () => [
    { value: Math.round(process.uptime()) },
  ]);

  return metrics;
}
