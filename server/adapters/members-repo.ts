import { and, eq, isNull, sql } from "drizzle-orm";
import type { MemberRecord, MembersRepository } from "../core/members";
import { invitations, memberships, user } from "../db/schema";
import { atomic } from "./atomic";
import type { Database } from "./db";

const memberColumns = {
  userId: memberships.userId,
  email: user.email,
  name: user.name,
  role: memberships.role,
  status: memberships.status,
};

export function createMembersRepository(db: Database): MembersRepository {
  return {
    async findByUserId(userId) {
      const rows = await db.select(memberColumns).from(memberships).innerJoin(user, eq(user.id, memberships.userId)).where(eq(memberships.userId, userId)).limit(1);
      return (rows[0] as MemberRecord | undefined) ?? null;
    },

    async findByEmail(email) {
      const rows = await db
        .select(memberColumns)
        .from(memberships)
        .innerJoin(user, eq(user.id, memberships.userId))
        .where(sql`${user.email} = ${email} collate nocase`)
        .limit(1);
      return (rows[0] as MemberRecord | undefined) ?? null;
    },

    async findUserEmail(userId) {
      const rows = await db.select({ email: user.email }).from(user).where(eq(user.id, userId)).limit(1);
      return rows[0]?.email ?? null;
    },

    async findOpenInvitation(email) {
      const rows = await db
        .select({ id: invitations.id, email: invitations.email, role: invitations.role })
        .from(invitations)
        .where(and(sql`${invitations.email} = ${email} collate nocase`, isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
        .limit(1);
      return rows[0] ?? null;
    },

    async createMembership({ userId, role, invitationId, now }) {
      await atomic(db, [
        () => db.insert(memberships).values({ userId, role, status: "active", createdAt: now, updatedAt: now }).onConflictDoNothing(),
        ...(invitationId
          ? [
              () =>
                db
                  .update(invitations)
                  .set({ acceptedAt: now, acceptedUserId: userId })
                  .where(and(eq(invitations.id, invitationId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt))),
            ]
          : []),
      ]);
    },

    async createInvitation({ id, email, role, invitedByUserId, now }) {
      const inserted = await db
        .insert(invitations)
        .values({ id, email, role, invitedByUserId, createdAt: now })
        .onConflictDoNothing()
        .returning({ id: invitations.id });
      return inserted.length > 0 ? "created" : "duplicate";
    },
  };
}
