import { z } from "zod";
import { decideSignIn, hasRole, normalizeEmail, ROLES, type MemberStatus, type Role, type SignInDecision, type Viewer } from "./access";
import type { Audit } from "./audit";
import { fail, ok, type Result } from "./result";

export interface MemberRecord {
  userId: string;
  email: string;
  name: string;
  role: Role;
  status: MemberStatus;
}

export interface InvitationRecord {
  id: string;
  email: string;
  role: Role;
}

/** A member as the owner console lists them. */
export interface MemberListItem extends MemberRecord {
  createdAt: Date;
  disabledAt: Date | null;
}

export interface OpenInvitation extends InvitationRecord {
  createdAt: Date;
}

/** Outcome of a guarded membership write. */
export type MemberUpdateOutcome = "updated" | "not_found" | "last_owner";

export interface MembersRepository {
  findByUserId(userId: string): Promise<MemberRecord | null>;
  findByEmail(email: string): Promise<MemberRecord | null>;
  /** Email of a Better Auth user, whether or not a membership exists. */
  findUserEmail(userId: string): Promise<string | null>;
  findOpenInvitation(email: string): Promise<InvitationRecord | null>;
  /**
   * Create the membership row (idempotent) and, when given, mark the invitation accepted, in one transaction.
   */
  createMembership(input: {
    userId: string;
    role: Role;
    invitationId: string | null;
    now: Date;
  }): Promise<void>;
  createInvitation(input: { id: string; email: string; role: Role; invitedByUserId: string; now: Date }): Promise<"created" | "duplicate">;
  listMembers(limit: number): Promise<MemberListItem[]>;
  listOpenInvitations(limit: number): Promise<OpenInvitation[]>;
  /** Mark an open invitation revoked. False when it is missing, accepted, or already revoked. */
  revokeInvitation(id: string, now: Date): Promise<boolean>;
  /**
   * Change a member's role and/or status in one guarded statement. When `keepActiveOwner` is set, the
   * write happens only if another active owner remains, so the sole owner can never be removed.
   * Disabling also deletes the member's sessions.
   */
  updateMember(input: {
    userId: string;
    role?: Role;
    status?: MemberStatus;
    keepActiveOwner: boolean;
    now: Date;
  }): Promise<MemberUpdateOutcome>;
}

export interface MembersDeps {
  repo: MembersRepository;
  audit?: Pick<Audit, "record">;
  ownerEmail: string;
  now: () => Date;
  newId: () => string;
}

export type Members = ReturnType<typeof createMembers>;

type Acting = Pick<Viewer, "userId" | "role" | "status">;

const emailSchema = z.email({ message: "Enter a valid email address." }).max(254, "Email addresses are at most 254 characters.");
const roleSchema = z.enum(ROLES, { message: "Choose reader, editor, or owner." });

const ROLE_LIST_LIMIT = 1000;

export function createMembers({ repo, audit, ownerEmail, now, newId }: MembersDeps) {
  const record = (actor: Acting, action: string, target: { type: string; id: string }, details?: Record<string, unknown>) =>
    audit?.record({ kind: "member", userId: actor.userId }, action, target, details) ?? Promise.resolve();
  const isOwner = (actor: Acting) => hasRole(actor, "owner");
  const notOwner = () => fail("forbidden", "Only the owner can manage members and invitations.");

  async function decide(email: string, emailVerified: boolean): Promise<SignInDecision> {
    const normalized = normalizeEmail(email);
    const [member, invitation] = await Promise.all([repo.findByEmail(normalized), repo.findOpenInvitation(normalized)]);
    return decideSignIn({ email: normalized, emailVerified, ownerEmail, member, invitation });
  }

  return {
    /** The sign-in gate, called before Better Auth creates or signs in a user. */
    checkSignIn: decide,

    /** Called after Better Auth creates a user: create the membership from the gate's decision. */
    async onUserCreated(user: { id: string; email: string; emailVerified: boolean }) {
      const decision = await decide(user.email, user.emailVerified);
      if (!decision.allow) return; // session creation is refused separately
      await repo.createMembership({ userId: user.id, role: decision.role, invitationId: decision.invitationId, now: now() });
    },

    /**
     * Last check before any session is created. Allows only active members, and bootstraps the owner's
     * membership if the owner's user row exists without one.
     */
    async allowSession(userId: string): Promise<boolean> {
      const member = await repo.findByUserId(userId);
      if (member) return member.status === "active";
      const email = await repo.findUserEmail(userId);
      if (email && normalizeEmail(email) === normalizeEmail(ownerEmail)) {
        await repo.createMembership({ userId, role: "owner", invitationId: null, now: now() });
        return true;
      }
      return false;
    },

    /** Current role and status, re-read on every protected request. Null when missing or disabled. */
    async getActive(userId: string): Promise<Viewer | null> {
      const member = await repo.findByUserId(userId);
      if (!member || member.status !== "active") return null;
      return { userId: member.userId, email: member.email, name: member.name, role: member.role, status: member.status };
    },

    /** Owner only: invite an exact email address (case-normalized) as a reader. */
    async invite(actor: Acting, email: string): Promise<Result<{ invitationId: string; email: string }>> {
      if (!isOwner(actor)) return notOwner();
      const parsed = emailSchema.safeParse(normalizeEmail(email));
      if (!parsed.success) return fail("invalid", "Invalid invitation.", { errors: { email: parsed.error.issues.map((i) => i.message) } });
      const normalized = parsed.data;
      if (await repo.findByEmail(normalized)) return fail("conflict", `${normalized} is already a member.`);
      const id = newId();
      const outcome = await repo.createInvitation({ id, email: normalized, role: "reader", invitedByUserId: actor.userId, now: now() });
      if (outcome !== "created") return fail("conflict", `${normalized} already has an open invitation.`);
      await record(actor, "invitation.create", { type: "invitation", id }, { role: "reader" });
      return ok({ invitationId: id, email: normalized });
    },

    /** Owner only: invitations not yet accepted or revoked, newest first. Null for anyone else. */
    async listInvitations(actor: Acting): Promise<OpenInvitation[] | null> {
      return isOwner(actor) ? repo.listOpenInvitations(ROLE_LIST_LIMIT) : null;
    },

    /** Owner only: revoke an unaccepted invitation, so it can no longer be used to register. */
    async revokeInvitation(actor: Acting, invitationId: string): Promise<Result<{ id: string }>> {
      if (!isOwner(actor)) return notOwner();
      if (!(await repo.revokeInvitation(invitationId, now()))) return fail("not_found", "That invitation is not open.");
      await record(actor, "invitation.revoke", { type: "invitation", id: invitationId });
      return ok({ id: invitationId });
    },

    /** Owner only: every member with role and status. Null for anyone else. */
    async listMembers(actor: Acting): Promise<MemberListItem[] | null> {
      return isOwner(actor) ? repo.listMembers(ROLE_LIST_LIMIT) : null;
    },

    /** Owner only: change a member's role. The sole active owner cannot be demoted. */
    async changeRole(actor: Acting, userId: string, role: string): Promise<Result<{ userId: string; role: Role }>> {
      if (!isOwner(actor)) return notOwner();
      const parsed = roleSchema.safeParse(role);
      if (!parsed.success) return fail("invalid", "Invalid role.", { errors: { role: parsed.error.issues.map((i) => i.message) } });
      const target = await repo.findByUserId(userId);
      if (!target) return fail("not_found", "Member not found.");
      if (target.role === parsed.data) return ok({ userId, role: parsed.data });
      const outcome = await repo.updateMember({ userId, role: parsed.data, keepActiveOwner: target.role === "owner", now: now() });
      if (outcome === "not_found") return fail("not_found", "Member not found.");
      if (outcome === "last_owner") return fail("conflict", "This is the only active owner. Make another member an owner first.");
      await record(actor, "member.role_change", { type: "member", id: userId }, { from: target.role, to: parsed.data });
      return ok({ userId, role: parsed.data });
    },

    /**
     * Owner only: disable or re-enable an account. Disabling ends the member's sessions; their agents stop
     * at the next call because agent auth re-reads status. Owners cannot disable themselves, and the
     * sole active owner cannot be disabled.
     */
    async setStatus(actor: Acting, userId: string, status: MemberStatus): Promise<Result<{ userId: string; status: MemberStatus }>> {
      if (!isOwner(actor)) return notOwner();
      if (status === "disabled" && userId === actor.userId) return fail("forbidden", "You can't disable your own account.");
      const target = await repo.findByUserId(userId);
      if (!target) return fail("not_found", "Member not found.");
      if (target.status === status) return ok({ userId, status });
      const outcome = await repo.updateMember({
        userId,
        status,
        keepActiveOwner: status === "disabled" && target.role === "owner",
        now: now(),
      });
      if (outcome === "not_found") return fail("not_found", "Member not found.");
      if (outcome === "last_owner") return fail("conflict", "This is the only active owner and cannot be disabled.");
      await record(actor, status === "disabled" ? "member.disable" : "member.enable", { type: "member", id: userId });
      return ok({ userId, status });
    },
  };
}
