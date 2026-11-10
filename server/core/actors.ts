// Who is acting. Core enforces every permission against the actor, so protocol layers cannot bypass the rules.
import { roleAtLeast, type Role } from "./access";

export const CREDENTIAL_KINDS = ["oauth", "api_key"] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

/** A signed-in member using the website. The caller has already checked the member is active. */
export type MemberActor = { kind: "member"; userId: string; role: Role };

/**
 * An agent acting as the member who connected it (MCP OAuth client or the member's API key).
 * The caller re-reads the member's status and current role on every call.
 */
export type AgentActor = {
  kind: "agent";
  userId: string;
  role: Role;
  credentialKind: CredentialKind;
  credentialId: string;
  /** Client name or key label, for "<member> via <label>" attribution. */
  label: string;
};

export type Actor = MemberActor | AgentActor;

/** Create publications: editors and the owner, directly or through their agents. Readers' agents are read-only. */
export function canCreatePublication(actor: Actor): boolean {
  return roleAtLeast(actor.role, "editor");
}

/** Update: editors (website) may update any publication; agents only the member's own, and only as editor or owner. */
export function canUpdatePublication(actor: Actor, creatorUserId: string): boolean {
  if (!roleAtLeast(actor.role, "editor")) return false;
  return actor.kind === "member" || actor.userId === creatorUserId;
}

/** History, restore, unpublish, publish, and homepage layout: editors on the website only. Never agents. */
export function canEdit(actor: Actor): actor is MemberActor {
  return actor.kind === "member" && roleAtLeast(actor.role, "editor");
}

/** Upload attachments: editors and the owner, directly or through their agents. */
export function canUpload(actor: Actor): boolean {
  return roleAtLeast(actor.role, "editor");
}
