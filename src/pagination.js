export const pageQuery = {
  limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
  cursor: { type: 'integer', minimum: 1 },
};

/**
 * Wraps one page of rows for the API. `fetchRows` is asked for one row more
 * than the page size: if it comes back, there is a next page.
 */
export function paginate({ limit, fetchRows, present }) {
  const rows = fetchRows(limit + 1);
  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;

  return {
    data: page.map(present),
    next_cursor: hasMore ? page.at(-1).seq : null,
  };
}
