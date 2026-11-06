import { decideSignIn, normalizeEmail, type MemberStatus, type Role, type SignInDecision, type Viewer } from "./access";

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
}

export interface MembersDeps {
  repo: MembersRepository;
  ownerEmail: string;
  now: () => Date;
  newId: () => string;
}

export type Members = ReturnType<typeof createMembers>;

export function createMembers({ repo, ownerEmail, now, newId }: MembersDeps) {
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

    /** Owner-only: invite an exact email address as a reader. Full invitation management arrives in lane 3A. */
    async invite(actor: Pick<Viewer, "userId" | "role" | "status">, email: string) {
      if (actor.status !== "active" || actor.role !== "owner") return { ok: false as const, status: "forbidden" as const };
      const id = newId();
      const outcome = await repo.createInvitation({ id, email: normalizeEmail(email), role: "reader", invitedByUserId: actor.userId, now: now() });
      return outcome === "created" ? { ok: true as const, invitationId: id } : { ok: false as const, status: "conflict" as const };
    },
  };
}
