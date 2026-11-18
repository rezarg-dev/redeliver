import { newId, newSecret } from '../ids.js';

export function sourcesStore(db) {
  const insert = db.prepare(
    `INSERT INTO sources (id, name, scheme, secret, created_at)
     VALUES (@id, @name, @scheme, @secret, @created_at)`,
  );
  const selectById = db.prepare('SELECT * FROM sources WHERE id = ?');
  const selectAll = db.prepare('SELECT * FROM sources ORDER BY rowid DESC');
  const deleteById = db.prepare('DELETE FROM sources WHERE id = ?');

  return {
    create({ name, scheme = 'hmac-sha256' }) {
      const source = {
        id: newId('src'),
        name,
        scheme,
        secret: newSecret(),
        created_at: Date.now(),
      };
      insert.run(source);
      return source;
    },

    get(id) {
      return selectById.get(id);
    },

    list() {
      return selectAll.all();
    },

    remove(id) {
      return deleteById.run(id).changes > 0;
    },
  };
}
