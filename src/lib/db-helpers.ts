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
/**
 * Most recent real contact with a property. Status changes are bookkeeping, not
 * outreach, so they are excluded - shared by the follow-up queues and the
 * "not contacted in N days" property filter so both agree on what "contacted" means.
 * Correlates on the `properties` table name, so it only works in a query over it.
 */
export const lastActivityAtSql: SQL = sql`(select max(a.occurred_at) from activities a
  where a.property_id = properties.id and a.type <> 'status_change')`;

export function sqlIn(column: SQL | string, values: readonly string[]): SQL {
  if (values.length === 0) return sql`false`;
  const col = typeof column === 'string' ? sql.raw(column) : column;
  return sql`${col} in (${sql.join(values.map((v) => sql`${v}`), sql`, `)})`;
}
