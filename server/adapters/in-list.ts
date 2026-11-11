import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

/**
 * `column IN (...ids)` with the whole list bound as one JSON value.
 * D1 allows at most 100 bound values per query ("too many SQL variables"), while better-sqlite3 allows
 * thousands, so a plain `inArray` over a long ID list passes local tests and fails in production.
 * `json_each` keeps any list to a single parameter on both.
 */
export function inList(column: SQLWrapper, values: readonly string[]): SQL {
  return sql`${column} in (select value from json_each(${JSON.stringify(values)}))`;
}
