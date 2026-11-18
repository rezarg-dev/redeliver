import { transaction } from '../db.js';
import { deliveriesStore } from './deliveries.js';
import { destinationsStore } from './destinations.js';
import { eventsStore } from './events.js';
import { sourcesStore } from './sources.js';

export function createStore(db) {
  const ping = db.prepare('SELECT 1 AS ok');

  return {
    sources: sourcesStore(db),
    destinations: destinationsStore(db),
    events: eventsStore(db),
    deliveries: deliveriesStore(db),

    isHealthy() {
      return ping.get().ok === 1;
    },

    transaction(fn) {
      return transaction(db, fn);
    },
  };
}
