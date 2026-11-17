import { newId } from '../ids.js';

export function destinationsStore(db) {
  const insert = db.prepare(
    `INSERT INTO destinations (id, source_id, url, secret, enabled, created_at)
     VALUES (@id, @source_id, @url, @secret, @enabled, @created_at)`,
  );
  const selectById = db.prepare('SELECT * FROM destinations WHERE id = ?');
  const selectBySource = db.prepare(
    'SELECT * FROM destinations WHERE source_id = ? ORDER BY rowid',
  );
  const selectEnabledBySource = db.prepare(
    'SELECT * FROM destinations WHERE source_id = ? AND enabled = 1 ORDER BY rowid',
  );
  const updateById = db.prepare(
    'UPDATE destinations SET url = @url, secret = @secret, enabled = @enabled WHERE id = @id',
  );
  const deleteById = db.prepare('DELETE FROM destinations WHERE id = ?');

  return {
    create({ sourceId, url, secret = null }) {
      const destination = {
        id: newId('dst'),
        source_id: sourceId,
        url,
        secret,
        enabled: 1,
        created_at: Date.now(),
      };
      insert.run(destination);
      return destination;
    },

    get(id) {
      return selectById.get(id);
    },

    listBySource(sourceId) {
      return selectBySource.all(sourceId);
    },

    listEnabledBySource(sourceId) {
      return selectEnabledBySource.all(sourceId);
    },

    /** Applies only the fields present in `changes`. Returns the updated row. */
    update(id, changes) {
      const current = selectById.get(id);
      if (!current) return undefined;

      const next = {
        id,
        url: changes.url ?? current.url,
        secret: changes.secret === undefined ? current.secret : changes.secret,
        enabled: changes.enabled === undefined ? current.enabled : Number(changes.enabled),
      };
      updateById.run(next);
      return { ...current, ...next };
    },

    remove(id) {
      return deleteById.run(id).changes > 0;
    },
  };
}
