import { desc, gte, lt, notInArray } from "drizzle-orm";
import type { AuditRepository } from "../core/audit";
import type { PublishingFailuresRepository } from "../core/publishing-failures";
import { auditEvents, publishingFailures } from "../db/schema";
import { atomic } from "./atomic";
import type { Database } from "./db";

export function createAuditRepository(db: Database): AuditRepository {
  return {
    async insert(event) {
      await db.insert(auditEvents).values(event);
    },
    async listRecent(limit) {
      const rows = await db.select().from(auditEvents).orderBy(desc(auditEvents.createdAt), desc(auditEvents.id)).limit(limit);
      return rows.map((r) => ({ ...r, details: r.details ?? null }));
    },
  };
}

export function createPublishingFailuresRepository(db: Database): PublishingFailuresRepository {
  return {
    async insertAndPrune(failure, olderThan, maxRows) {
      const newest = db.select({ id: publishingFailures.id }).from(publishingFailures).orderBy(desc(publishingFailures.createdAt), desc(publishingFailures.id)).limit(maxRows);
      await atomic(db, [
        () => db.insert(publishingFailures).values(failure),
        () => db.delete(publishingFailures).where(lt(publishingFailures.createdAt, olderThan)),
        () => db.delete(publishingFailures).where(notInArray(publishingFailures.id, newest)),
      ]);
    },
    async listRecent(since, limit) {
      const rows = await db
        .select()
        .from(publishingFailures)
        .where(gte(publishingFailures.createdAt, since))
        .orderBy(desc(publishingFailures.createdAt), desc(publishingFailures.id))
        .limit(limit);
      return rows;
    },
  };
}
