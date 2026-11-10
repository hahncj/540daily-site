// Audit events for account, role, credential, and publishing actions. No secrets or request bodies.
import type { Actor } from "./actors";
import { hasRole, type Role } from "./access";

export type AuditEvent = {
  id: string;
  actorUserId: string | null;
  actorKind: "member" | "agent";
  credentialId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown> | null;
  createdAt: Date;
};

export interface AuditRepository {
  insert(event: AuditEvent): Promise<void>;
  listRecent(limit: number): Promise<AuditEvent[]>;
}

/** Details are small, flat facts (IDs, revision numbers, statuses). Long strings are cut. */
const MAX_DETAIL_KEYS = 20;
const MAX_DETAIL_STRING = 200;

function boundDetails(details: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!details) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details).slice(0, MAX_DETAIL_KEYS)) {
    if (typeof value === "string") out[key] = value.slice(0, MAX_DETAIL_STRING);
    else if (typeof value === "number" || typeof value === "boolean" || value === null) out[key] = value;
  }
  return out;
}

export type Audit = ReturnType<typeof createAudit>;

export function createAudit({ repo, now, newId }: { repo: AuditRepository; now: () => Date; newId: () => string }) {
  return {
    /** Best effort: an audit write failure is logged and never fails the action that already succeeded. */
    async record(
      actor: Pick<Actor, "kind" | "userId"> & { credentialId?: string } | null,
      action: string,
      target?: { type: string; id: string },
      details?: Record<string, unknown>,
    ): Promise<void> {
      try {
        await repo.insert({
          id: newId(),
          actorUserId: actor?.userId ?? null,
          actorKind: actor?.kind ?? "member",
          credentialId: actor?.credentialId ?? null,
          action,
          targetType: target?.type ?? null,
          targetId: target?.id ?? null,
          details: boundDetails(details),
          createdAt: now(),
        });
      } catch (error) {
        console.error(JSON.stringify({ event: "audit_write_failed", action, error: String(error) }));
      }
    },

    /** Owner only. */
    async listRecent(viewer: { role: Role; status: "active" | "disabled" }, limit = 100) {
      if (!hasRole(viewer, "owner")) return null;
      return repo.listRecent(Math.min(Math.max(limit, 1), 500));
    },
  };
}
