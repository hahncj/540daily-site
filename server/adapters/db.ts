import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type * as schema from "../db/schema";

/** One type for both drivers: D1 (async) on Workers and better-sqlite3 (sync) in tests. Always await queries. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Database = BaseSQLiteDatabase<"sync" | "async", any, typeof schema>;
