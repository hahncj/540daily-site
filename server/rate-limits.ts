// Per-member agent rate limits, shared across Worker instances through D1. Fixed one-minute windows.
// Defaults (REQUIREMENTS.md section 9): 60 requests, of which 10 writes and 5 upload initiations, per
// member per minute, across all of that member's keys and connections. These are 540 Daily settings,
// not Cloudflare service limits.
import { and, eq, lt, sql } from "drizzle-orm";
import type { Database } from "./adapters/db";
import type { AppConfig } from "./config";
import { rateLimitCounters } from "./db/schema";

export type RateBucket = "requests" | "writes" | "uploads";
export type RateDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

const WINDOW_MS = 60_000;

export type RateLimits = ReturnType<typeof createRateLimits>;

export function createRateLimits({ db, config, now }: { db: Database; config: Pick<AppConfig, "rateLimits">; now: () => Date }) {
  return {
    /**
     * Count one hit for the member in `bucket`. One statement: insert the window's counter or increment
     * it only while it is under the limit. No returned row means the limit was already reached.
     */
    async hit(userId: string, bucket: RateBucket): Promise<RateDecision> {
      const limit = config.rateLimits[bucket];
      const at = now().getTime();
      const windowStart = at - (at % WINDOW_MS);
      const rows = await db
        .insert(rateLimitCounters)
        .values({ userId, bucket, windowStart, count: 1 })
        .onConflictDoUpdate({
          target: [rateLimitCounters.userId, rateLimitCounters.bucket, rateLimitCounters.windowStart],
          set: { count: sql`${rateLimitCounters.count} + 1` },
          setWhere: sql`${rateLimitCounters.count} < ${limit}`,
        })
        .returning({ count: rateLimitCounters.count });
      const count = rows[0]?.count;
      if (count === undefined) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((windowStart + WINDOW_MS - at) / 1000)) };
      if (count === 1) {
        // First hit in a new window: drop this member's old windows (primary-key prefix, so it is cheap).
        try {
          await db.delete(rateLimitCounters).where(and(eq(rateLimitCounters.userId, userId), lt(rateLimitCounters.windowStart, windowStart)));
        } catch (error) {
          console.error(JSON.stringify({ event: "rate_limit_prune_failed", error: String(error) }));
        }
      }
      return { allowed: true };
    },
  };
}
