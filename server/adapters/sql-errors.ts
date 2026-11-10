/**
 * True when a query failed a UNIQUE or NOT NULL (or other) constraint. Works for better-sqlite3
 * (`SqliteError`, code `SQLITE_CONSTRAINT_*`), D1 (`D1_ERROR: UNIQUE constraint failed`), and Drizzle's
 * wrapping `DrizzleQueryError` (original error in `cause`).
 */
export function isConstraintError(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 5; depth++) {
    const v = e as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof v.code === "string" && v.code.startsWith("SQLITE_CONSTRAINT")) return true;
    if (typeof v.message === "string" && /constraint failed/i.test(v.message)) return true;
    e = v.cause;
  }
  return false;
}
