import { and, eq, gt, isNull, lt, notExists, sql } from "drizzle-orm";
import type { AttachmentRecord, AttachmentsRepository } from "../core/attachments";
import { attachmentReferences, attachments, publications, uploadTickets } from "../db/schema";
import { atomic, changesOf } from "./atomic";
import type { Database } from "./db";
import { inList } from "./in-list";

const unreferenced = (db: Database) =>
  notExists(db.select({ one: sql`1` }).from(attachmentReferences).where(eq(attachmentReferences.attachmentId, attachments.id)));

export function createAttachmentsRepository(db: Database): AttachmentsRepository {
  return {
    async createPending(attachment, ticket) {
      await atomic(db, [
        () => db.insert(attachments).values({ ...attachment, status: "pending" }),
        () => db.insert(uploadTickets).values(ticket),
      ]);
    },

    async findTicketByHash(tokenHash) {
      const rows = await db
        .select({
          id: uploadTickets.id,
          attachmentId: uploadTickets.attachmentId,
          userId: uploadTickets.userId,
          mimeType: uploadTickets.mimeType,
          maxSize: uploadTickets.maxSize,
          expiresAt: uploadTickets.expiresAt,
          usedAt: uploadTickets.usedAt,
        })
        .from(uploadTickets)
        .where(eq(uploadTickets.tokenHash, tokenHash))
        .limit(1);
      return rows[0] ?? null;
    },

    async claimTicket(ticketId, now) {
      const result = await db
        .update(uploadTickets)
        .set({ usedAt: now })
        .where(and(eq(uploadTickets.id, ticketId), isNull(uploadTickets.usedAt), gt(uploadTickets.expiresAt, now)));
      return changesOf(result) === 1;
    },

    async releaseTicket(ticketId) {
      await db.update(uploadTickets).set({ usedAt: null }).where(eq(uploadTickets.id, ticketId));
    },

    async markReady(attachmentId, { size, sha256, readyAt }) {
      await db.update(attachments).set({ status: "ready", size, sha256, readyAt }).where(eq(attachments.id, attachmentId));
    },

    async markRejected(attachmentId) {
      await db.update(attachments).set({ status: "rejected" }).where(and(eq(attachments.id, attachmentId), eq(attachments.status, "pending")));
    },

    async get(id) {
      const rows = await db.select().from(attachments).where(eq(attachments.id, id)).limit(1);
      return (rows[0] as AttachmentRecord | undefined) ?? null;
    },

    async getMany(ids) {
      if (ids.length === 0) return [];
      return (await db.select().from(attachments).where(inList(attachments.id, [...ids]))) as AttachmentRecord[];
    },

    async referencedByPublication(ids, publicationId) {
      if (ids.length === 0) return new Set();
      const rows = await db
        .selectDistinct({ id: attachmentReferences.attachmentId })
        .from(attachmentReferences)
        .where(and(eq(attachmentReferences.publicationId, publicationId), inList(attachmentReferences.attachmentId, [...ids])));
      return new Set(rows.map((r) => r.id));
    },

    async isPubliclyVisible(id) {
      const rows = await db
        .select({ one: sql`1` })
        .from(attachmentReferences)
        .innerJoin(
          publications,
          and(eq(publications.id, attachmentReferences.publicationId), eq(publications.revision, attachmentReferences.revision)),
        )
        .where(and(eq(attachmentReferences.attachmentId, id), eq(publications.status, "published")))
        .limit(1);
      return rows.length > 0;
    },

    async listUnreferencedBefore(cutoff, limit) {
      return (await db
        .select()
        .from(attachments)
        .where(and(lt(attachments.createdAt, cutoff), unreferenced(db)))
        .limit(limit)) as AttachmentRecord[];
    },

    async deleteIfUnreferenced(ids) {
      if (ids.length === 0) return [];
      const stillFree = await db
        .select({ id: attachments.id })
        .from(attachments)
        .where(and(inList(attachments.id, [...ids]), unreferenced(db)));
      const free = stillFree.map((r) => r.id);
      if (free.length === 0) return [];
      // The NOT EXISTS guard repeats in the delete, so a reference added in between keeps the row.
      await atomic(db, [
        () => db.delete(uploadTickets).where(and(inList(uploadTickets.attachmentId, free), notExists(db.select({ one: sql`1` }).from(attachmentReferences).where(eq(attachmentReferences.attachmentId, uploadTickets.attachmentId))))),
        () => db.delete(attachments).where(and(inList(attachments.id, free), unreferenced(db))),
      ]);
      const remaining = new Set((await db.select({ id: attachments.id }).from(attachments).where(inList(attachments.id, free))).map((r) => r.id));
      return free.filter((id) => !remaining.has(id));
    },
  };
}
