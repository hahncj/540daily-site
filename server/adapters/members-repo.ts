import { and, asc, desc, eq, isNull, ne, or, sql } from "drizzle-orm";
import type { MemberListItem, MemberRecord, MembersRepository } from "../core/members";
import { invitations, memberships, session, user } from "../db/schema";
import { atomic, changesOf } from "./atomic";
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

    async listMembers(limit) {
      const rows = await db
        .select({ ...memberColumns, createdAt: memberships.createdAt, disabledAt: memberships.disabledAt })
        .from(memberships)
        .innerJoin(user, eq(user.id, memberships.userId))
        .orderBy(asc(memberships.createdAt), asc(user.email))
        .limit(limit);
      return rows as MemberListItem[];
    },

    async listOpenInvitations(limit) {
      return db
        .select({ id: invitations.id, email: invitations.email, role: invitations.role, createdAt: invitations.createdAt })
        .from(invitations)
        .where(and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
        .orderBy(desc(invitations.createdAt))
        .limit(limit);
    },

    async revokeInvitation(id, now) {
      const rows = await db
        .update(invitations)
        .set({ revokedAt: now })
        .where(and(eq(invitations.id, id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
        .returning({ id: invitations.id });
      return rows.length > 0;
    },

    async updateMember({ userId, role, status, keepActiveOwner, now }) {
      const changes: Partial<typeof memberships.$inferInsert> = { updatedAt: now };
      if (role) changes.role = role;
      if (status) {
        changes.status = status;
        changes.disabledAt = status === "disabled" ? now : null;
      }
      // One statement, judged on the row's current state, so concurrent changes cannot remove the last active owner.
      const anotherActiveOwner = sql`exists (select 1 from ${memberships} as other where other.role = 'owner' and other.status = 'active' and other.user_id <> ${userId})`;
      const where = keepActiveOwner
        ? and(eq(memberships.userId, userId), or(ne(memberships.role, "owner"), ne(memberships.status, "active"), anotherActiveOwner))
        : eq(memberships.userId, userId);
      const [updated] = await atomic(db, [
        () => db.update(memberships).set(changes).where(where),
        // Disabling ends every session at once (the membership check on each request is the main guard).
        ...(status === "disabled"
          ? [
              () =>
                db
                  .delete(session)
                  .where(
                    and(
                      eq(session.userId, userId),
                      sql`exists (select 1 from ${memberships} where ${memberships.userId} = ${userId} and ${memberships.status} = 'disabled')`,
                    ),
                  ),
            ]
          : []),
      ]);
      if (changesOf(updated) > 0) return "updated";
      const [exists] = await db.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.userId, userId)).limit(1);
      return exists ? "last_owner" : "not_found";
    },
  };
}
