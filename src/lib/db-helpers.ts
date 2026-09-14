import { sql, type SQL } from 'drizzle-orm';

/**
 * Builds a parameterised `IN (...)` list.
 *
 * Interpolating a JavaScript array directly into a `sql` template renders it as
 * a row constructor — `($1, $2)` — which Postgres refuses to cast to an array
 * type ("cannot cast type record to uuid[]"). This emits one bind parameter per
 * value instead, which is both correct and safe from injection.
 *
 * Returns `false` for an empty list so the surrounding predicate matches nothing
 * rather than producing invalid `IN ()` syntax.
 */
export function sqlIn(column: SQL | string, values: readonly string[]): SQL {
  if (values.length === 0) return sql`false`;
  const col = typeof column === 'string' ? sql.raw(column) : column;
  return sql`${col} in (${sql.join(values.map((v) => sql`${v}`), sql`, `)})`;
}
