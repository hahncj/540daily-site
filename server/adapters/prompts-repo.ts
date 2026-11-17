// Drizzle implementation of PromptsRepository. A save is one guarded insert: it writes revision N
// only when the current revision is N - 1, and the (key, revision) primary key stops a racing save.
import { and, desc, eq, sql } from "drizzle-orm";
import type { PromptKey, PromptRevision, PromptsRepository } from "../core/prompts";
import { agentPromptRevisions } from "../db/schema";
import { changesOf } from "./atomic";
import type { Database } from "./db";
import { isConstraintError } from "./sql-errors";

const columns = {
  key: agentPromptRevisions.key,
  revision: agentPromptRevisions.revision,
  body: agentPromptRevisions.body,
  note: agentPromptRevisions.note,
  createdAt: agentPromptRevisions.createdAt,
  createdByUserId: agentPromptRevisions.createdByUserId,
};

const toRevision = (row: Omit<PromptRevision, "key"> & { key: string }): PromptRevision => ({ ...row, key: row.key as PromptKey });

export function createPromptsRepository(db: Database): PromptsRepository {
  return {
    async current(key) {
      const rows = await db.select(columns).from(agentPromptRevisions).where(eq(agentPromptRevisions.key, key)).orderBy(desc(agentPromptRevisions.revision)).limit(1);
      return rows[0] ? toRevision(rows[0]) : null;
    },

    async get(key, revision) {
      const rows = await db
        .select(columns)
        .from(agentPromptRevisions)
        .where(and(eq(agentPromptRevisions.key, key), eq(agentPromptRevisions.revision, revision)))
        .limit(1);
      return rows[0] ? toRevision(rows[0]) : null;
    },

    async history(key, limit) {
      const rows = await db.select(columns).from(agentPromptRevisions).where(eq(agentPromptRevisions.key, key)).orderBy(desc(agentPromptRevisions.revision)).limit(limit);
      return rows.map(toRevision);
    },

    async append(r) {
      try {
        const result = await db.run(sql`insert into ${agentPromptRevisions} (key, revision, body, note, created_at, created_by_user_id)
          select ${r.key}, ${r.revision}, ${r.body}, ${r.note}, ${r.createdAt.getTime()}, ${r.createdByUserId}
          where (select coalesce(max(revision), 0) from ${agentPromptRevisions} where key = ${r.key}) = ${r.revision - 1}`);
        return changesOf(result) > 0 ? "written" : "stale";
      } catch (error) {
        if (isConstraintError(error)) return "stale";
        throw error;
      }
    },
  };
}
