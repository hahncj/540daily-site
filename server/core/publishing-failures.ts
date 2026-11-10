// Bounded log of failed publishing attempts, behind the owner's "recent publishing failures" view.
// Retention: 30 days and at most MAX_ROWS rows, pruned on every write. No credentials or request bodies.
import { hasRole, type MemberStatus, type Role } from "./access";
import type { CredentialKind } from "./actors";

export const FAILURE_RETENTION_DAYS = 30;
export const FAILURE_MAX_ROWS = 5000;
const MAX_MESSAGE = 500;

export type PublishingFailure = {
  id: string;
  operationId: string;
  userId: string | null;
  credentialKind: CredentialKind | null;
  credentialId: string | null;
  operation: string;
  status: string;
  message: string;
  externalId: string | null;
  createdAt: Date;
};

export interface PublishingFailuresRepository {
  /** Insert, then delete rows older than `olderThan` and any beyond the newest `maxRows`. */
  insertAndPrune(failure: PublishingFailure, olderThan: Date, maxRows: number): Promise<void>;
  listRecent(since: Date, limit: number): Promise<PublishingFailure[]>;
}

export type PublishingFailures = ReturnType<typeof createPublishingFailures>;

export function createPublishingFailures({ repo, now, newId }: { repo: PublishingFailuresRepository; now: () => Date; newId: () => string }) {
  const cutoff = () => new Date(now().getTime() - FAILURE_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  return {
    /** Best effort: logging a failure must never throw over the original error. */
    async record(input: Omit<PublishingFailure, "id" | "createdAt" | "operationId"> & { operationId?: string }): Promise<void> {
      try {
        await repo.insertAndPrune(
          {
            ...input,
            id: newId(),
            operationId: input.operationId ?? newId(),
            message: input.message.slice(0, MAX_MESSAGE),
            externalId: input.externalId?.slice(0, 128) ?? null,
            createdAt: now(),
          },
          cutoff(),
          FAILURE_MAX_ROWS,
        );
      } catch (error) {
        console.error(JSON.stringify({ event: "publishing_failure_log_failed", operation: input.operation, error: String(error) }));
      }
    },

    /** Owner only: the last 30 days, newest first. Null when the viewer is not the owner. */
    async listRecent(viewer: { role: Role; status: MemberStatus }, limit = 100) {
      if (!hasRole(viewer, "owner")) return null;
      return repo.listRecent(cutoff(), Math.min(Math.max(limit, 1), 500));
    },
  };
}
