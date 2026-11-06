import type { Database } from "./db";

/**
 * Run statements as one transaction: a D1 batch on Workers, a SQLite transaction in tests.
 * Statements cannot read each other's results. Read first, then write conditionally in one batch.
 */
export async function atomic(db: Database, statements: Array<() => unknown>): Promise<unknown[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;
  if (typeof anyDb.batch === "function") return anyDb.batch(statements.map((build) => build()));
  const results: unknown[] = [];
  anyDb.transaction(() => {
    for (const build of statements) {
      const query = build() as { run?: () => unknown } | undefined;
      results.push(typeof query?.run === "function" ? query.run() : query);
    }
  });
  return results;
}

/** Affected rows: D1 `{ meta: { changes } }` or better-sqlite3 `{ changes }`. */
export function changesOf(result: unknown): number {
  const v = result as { changes?: number; meta?: { changes?: number } } | undefined;
  return v?.meta?.changes ?? v?.changes ?? 0;
}
