// Roles, membership rules, and invitation matching. Pure logic: no framework, driver, or SDK imports.

export const ROLES = ["reader", "editor", "owner"] as const;
export type Role = (typeof ROLES)[number];

export const MEMBER_STATUSES = ["active", "disabled"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

const RANK: Record<Role, number> = { reader: 0, editor: 1, owner: 2 };

/** True when `role` is at least `min` (reader < editor < owner). */
export function roleAtLeast(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min];
}

export interface Viewer {
  userId: string;
  email: string;
  name: string;
  role: Role;
  status: MemberStatus;
}

/** Only active members count. A disabled member has no access, whatever their role. */
export function hasRole(viewer: Pick<Viewer, "role" | "status">, min: Role): boolean {
  return viewer.status === "active" && roleAtLeast(viewer.role, min);
}

/**
 * Exact address, case-normalized. No Gmail-specific alias rewriting (dots and +tags are kept).
 */
export function normalizeEmail(email: string): string {
  return email.normalize("NFC").trim().toLowerCase();
}

export interface SignInFacts {
  email: string;
  emailVerified: boolean;
  ownerEmail: string;
  /** Existing membership for this email, if any. */
  member: { role: Role; status: MemberStatus } | null;
  /** Open (not accepted, not revoked) invitation for this exact email, if any. */
  invitation: { id: string; role: Role } | null;
}

export type SignInDecision =
  | { allow: true; role: Role; via: "owner" | "member" | "invitation"; invitationId: string | null }
  | { allow: false; reason: "email_not_verified" | "account_disabled" | "not_invited" };

/**
 * The membership gate. A verified Google email may sign in only if it is the configured owner,
 * an existing active member, or holds an open invitation. Everyone else is refused and no account is created.
 */
export function decideSignIn(facts: SignInFacts): SignInDecision {
  if (!facts.emailVerified) return { allow: false, reason: "email_not_verified" };
  const email = normalizeEmail(facts.email);
  if (facts.member?.status === "disabled") return { allow: false, reason: "account_disabled" };
  if (email === normalizeEmail(facts.ownerEmail)) return { allow: true, role: "owner", via: "owner", invitationId: null };
  if (facts.member) return { allow: true, role: facts.member.role, via: "member", invitationId: null };
  if (facts.invitation) {
    return { allow: true, role: facts.invitation.role, via: "invitation", invitationId: facts.invitation.id };
  }
  return { allow: false, reason: "not_invited" };
}

export const SIGN_IN_REFUSAL_MESSAGES: Record<Extract<SignInDecision, { allow: false }>["reason"], string> = {
  email_not_verified: "Your Google email address is not verified.",
  account_disabled: "This account has been disabled.",
  not_invited: "540 News accounts are invitation-only. Ask the owner for an invitation.",
};
