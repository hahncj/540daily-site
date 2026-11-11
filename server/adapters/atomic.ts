import { entityKind } from "drizzle-orm";
import type { Database } from "./db";

/**
 * Run statements as one transaction: a D1 batch on Workers, a SQLite transaction in tests.
 * Statements cannot read each other's results. Read first, then write conditionally in one batch.
 */
export async function atomic(db: Database, statements: Array<() => unknown>): Promise<unknown[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;
  if (typeof anyDb.batch === "function") {
    const queries = statements.map((build) => build());
    for (const query of queries) prepareRawForD1Batch(anyDb.$client, query);
    return anyDb.batch(queries);
  }
  const results: unknown[] = [];
  anyDb.transaction(() => {
    for (const build of statements) {
      const query = build() as { run?: () => unknown } | undefined;
      results.push(typeof query?.run === "function" ? query.run() : query);
    }
  });
  return results;
}

/**
 * Work around a drizzle-orm D1 bug: `db.run(sql\`...\`)` with parameters crashes inside `db.batch()`
 * ("Cannot read properties of undefined (reading 'bind')") because raw queries carry no prepared `stmt`.
 * Give each raw query the D1 statement drizzle expects; its result mapping is unchanged.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function prepareRawForD1Batch(client: { prepare(sql: string): unknown } | undefined, query: any) {
  if (!client || !query || query.constructor?.[entityKind] !== "SQLiteRaw" || query.stmt) return;
  query.stmt = client.prepare(query.getQuery().sql);
}

/** Affected rows: D1 `{ meta: { changes } }` or better-sqlite3 `{ changes }`. */
export function changesOf(result: unknown): number {
  const v = result as { changes?: number; meta?: { changes?: number } } | undefined;
  return v?.meta?.changes ?? v?.changes ?? 0;
}
