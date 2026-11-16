import { sourcesStore } from './sources.js';

export function createStore(db) {
  const ping = db.prepare('SELECT 1').pluck();

  return {
    sources: sourcesStore(db),

    isHealthy() {
      return ping.get() === 1;
    },

    transaction(fn) {
      return db.transaction(fn)();
    },
  };
}
