// Attachment rules: type, size, signature, alt text, ownership, single-use upload tickets, and the
// visibility check before serving. Bytes live in a private bucket behind `AttachmentStorage`.
import { z } from "zod";
import { hasRole, type MemberStatus, type Role } from "./access";
import { canUpload, type Actor } from "./actors";
import type { Audit } from "./audit";
import { randomToken, sha256Hex } from "./hash";
import { ATTACHMENT_ID_PATTERN, type RenderableAttachment } from "./markdown";
import { fail, fieldErrors, ok, type Result } from "./result";

export const ATTACHMENT_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type AttachmentMime = (typeof ATTACHMENT_MIME_TYPES)[number];
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const UPLOAD_TICKET_TTL_MS = 15 * 60 * 1000;
export const CLEANUP_MIN_AGE_DAYS = 7;
export const MAX_ALT_TEXT = 500;

export type AttachmentStatus = "pending" | "ready" | "rejected";

export type AttachmentRecord = {
  id: string;
  uploaderUserId: string;
  storageKey: string;
  mimeType: string;
  size: number;
  sha256: string | null;
  altText: string;
  status: AttachmentStatus;
  createdAt: Date;
  readyAt: Date | null;
};

export type UploadTicket = {
  id: string;
  attachmentId: string;
  userId: string;
  mimeType: string;
  maxSize: number;
  expiresAt: Date;
  usedAt: Date | null;
};

/** Byte storage port. `MediaStore` (R2, filesystem, memory) satisfies it. */
export interface AttachmentStorage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: ReadableStream; contentType: string; size: number } | null>;
  delete(key: string): Promise<void>;
}

export interface AttachmentsRepository {
  createPending(
    attachment: Omit<AttachmentRecord, "sha256" | "status" | "readyAt">,
    ticket: Omit<UploadTicket, "usedAt"> & { tokenHash: string; createdAt: Date },
  ): Promise<void>;
  findTicketByHash(tokenHash: string): Promise<UploadTicket | null>;
  /** Mark the ticket used if it is unused and unexpired. False when another request got there first. */
  claimTicket(ticketId: string, now: Date): Promise<boolean>;
  releaseTicket(ticketId: string): Promise<void>;
  markReady(attachmentId: string, facts: { size: number; sha256: string; readyAt: Date }): Promise<void>;
  markRejected(attachmentId: string): Promise<void>;
  get(id: string): Promise<AttachmentRecord | null>;
  getMany(ids: readonly string[]): Promise<AttachmentRecord[]>;
  /** IDs among `ids` referenced by any revision of the publication. */
  referencedByPublication(ids: readonly string[], publicationId: string): Promise<Set<string>>;
  /** Referenced by the current revision of a published publication. */
  isPubliclyVisible(id: string): Promise<boolean>;
  /** Attachments with no references at all, created before `cutoff`. */
  listUnreferencedBefore(cutoff: Date, limit: number): Promise<AttachmentRecord[]>;
  /** Delete rows (and their tickets) only if still unreferenced. Returns the IDs deleted. */
  deleteIfUnreferenced(ids: readonly string[]): Promise<string[]>;
}

const SIGNATURES: Array<{ mime: AttachmentMime; test: (b: Uint8Array) => boolean }> = [
  { mime: "image/png", test: (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v) },
  { mime: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: "image/webp",
    test: (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP",
  },
];

function ascii(bytes: Uint8Array, start: number, length: number) {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

/** The image type from the file's magic bytes, or null. Extensions and declared types are not trusted. */
export function sniffImageType(bytes: Uint8Array): AttachmentMime | null {
  if (bytes.byteLength < 12) return null;
  return SIGNATURES.find((s) => s.test(bytes))?.mime ?? null;
}

export const prepareUploadSchema = z.object({
  mimeType: z.enum(ATTACHMENT_MIME_TYPES, { message: "Use image/png, image/jpeg, or image/webp." }),
  size: z.number().int().positive().describe("Exact size in bytes, at most 10 MiB."),
  altText: z.string().trim().min(1, "Alt text is required.").max(MAX_ALT_TEXT),
});
export type PrepareUploadInput = z.input<typeof prepareUploadSchema>;

export type AttachmentInfo = { id: string; status: AttachmentStatus; mimeType: string; size: number; altText: string; createdAt: Date };

const info = (a: AttachmentRecord): AttachmentInfo => ({
  id: a.id,
  status: a.status,
  mimeType: a.mimeType,
  size: a.size,
  altText: a.altText,
  createdAt: a.createdAt,
});

type ViewerLike = { userId: string; role: Role; status: MemberStatus } | null;

export type Attachments = ReturnType<typeof createAttachments>;

export function createAttachments({
  repo,
  storage,
  audit,
  now,
  newId,
}: {
  repo: AttachmentsRepository;
  storage: AttachmentStorage;
  audit: Audit;
  now: () => Date;
  newId: () => string;
}) {
  return {
    /**
     * Start an upload: returns a short-lived, single-use ticket bound to this member, the MIME type, and
     * the declared size. The protocol layer turns `token` into the upload URL.
     */
    async prepareUpload(
      actor: Actor,
      input: unknown,
    ): Promise<Result<{ attachmentId: string; token: string; expiresAt: Date; mimeType: AttachmentMime; maxSize: number }>> {
      if (!canUpload(actor)) return fail("forbidden", "Only editors and the owner can upload attachments.");
      const raw = input as { size?: unknown } | null;
      if (typeof raw?.size === "number" && raw.size > MAX_ATTACHMENT_BYTES) {
        return fail("too_large", "Attachments can be at most 10 MiB.");
      }
      const parsed = prepareUploadSchema.safeParse(input);
      if (!parsed.success) return fail("invalid", "Invalid attachment upload.", { errors: fieldErrors(parsed.error.issues) });
      const { mimeType, size, altText } = parsed.data;
      const at = now();
      const id = newId();
      const token = randomToken();
      const expiresAt = new Date(at.getTime() + UPLOAD_TICKET_TTL_MS);
      await repo.createPending(
        { id, uploaderUserId: actor.userId, storageKey: `attachments/${id}`, mimeType, size, altText, createdAt: at },
        { id: newId(), tokenHash: await sha256Hex(token), attachmentId: id, userId: actor.userId, mimeType, maxSize: size, expiresAt, createdAt: at },
      );
      await audit.record(actor, "attachment.prepare_upload", { type: "attachment", id }, { size, mimeType });
      return ok({ attachmentId: id, token, expiresAt, mimeType, maxSize: size });
    },

    /**
     * Finish an upload with the raw bytes. The ticket is the only credential. Checks the size and the
     * file signature, stores the bytes, and marks the attachment ready. A rejected file cannot be retried
     * with the same ticket; a storage failure releases the ticket so the same upload can be retried.
     */
    async completeUpload(token: string, bytes: Uint8Array): Promise<Result<AttachmentInfo>> {
      const expired = fail("not_found", "This upload link is invalid, already used, or expired.");
      if (!token || token.length > 128) return expired;
      const ticket = await repo.findTicketByHash(await sha256Hex(token));
      const at = now();
      if (!ticket || ticket.usedAt || ticket.expiresAt.getTime() <= at.getTime()) return expired;
      if (!(await repo.claimTicket(ticket.id, at))) return expired;

      if (bytes.byteLength > Math.min(ticket.maxSize, MAX_ATTACHMENT_BYTES)) {
        await repo.markRejected(ticket.attachmentId);
        return fail("too_large", `The file is larger than the ${ticket.maxSize} bytes declared for this upload.`);
      }
      if (bytes.byteLength === 0) {
        await repo.markRejected(ticket.attachmentId);
        return fail("invalid", "The file is empty.");
      }
      const sniffed = sniffImageType(bytes);
      if (sniffed !== ticket.mimeType) {
        await repo.markRejected(ticket.attachmentId);
        return fail("invalid", sniffed ? `The file is ${sniffed}, not ${ticket.mimeType}.` : "The file is not a PNG, JPEG, or WebP image.");
      }
      const attachment = await repo.get(ticket.attachmentId);
      if (!attachment) return expired;
      const digest = await sha256Hex(bytes);
      try {
        await storage.put(attachment.storageKey, bytes, ticket.mimeType);
      } catch (error) {
        console.error(JSON.stringify({ event: "attachment_store_failed", attachmentId: attachment.id, error: String(error) }));
        await repo.releaseTicket(ticket.id);
        return fail("unavailable", "Storage is unavailable. Retry the upload.");
      }
      try {
        await repo.markReady(attachment.id, { size: bytes.byteLength, sha256: digest, readyAt: now() });
      } catch (error) {
        // Bytes are stored under a fixed key, so a retry with the same ticket simply overwrites them.
        console.error(JSON.stringify({ event: "attachment_ready_failed", attachmentId: attachment.id, error: String(error) }));
        await repo.releaseTicket(ticket.id).catch(() => undefined);
        return fail("unavailable", "The upload could not be finished. Retry.");
      }
      return ok(info({ ...attachment, size: bytes.byteLength, status: "ready" }));
    },

    /** Upload status for the uploading member only. Anyone else gets not_found. */
    async status(actor: Actor, id: string): Promise<Result<AttachmentInfo>> {
      const a = ATTACHMENT_ID_PATTERN.test(id) ? await repo.get(id) : null;
      if (!a || a.uploaderUserId !== actor.userId) return fail("not_found", "Attachment not found.");
      return ok(info(a));
    },

    /**
     * Check attachments a publication version wants to use. Every ID must be a ready upload by the acting
     * member, or already used by the publication being updated (so an agent can keep an image an editor added).
     */
    async authorize(actor: Actor, ids: readonly string[], publicationId: string | null): Promise<Result<RenderableAttachment[]>> {
      if (ids.length === 0) return ok([]);
      const found = new Map((await repo.getMany(ids)).map((a) => [a.id, a]));
      const notOwn = ids.filter((id) => found.get(id)?.uploaderUserId !== actor.userId);
      // Callers have already checked the actor may update `publicationId`; keeping its existing assets is not reuse.
      const inherited = notOwn.length && publicationId ? await repo.referencedByPublication(notOwn, publicationId) : new Set<string>();
      const problems: string[] = [];
      for (const id of ids) {
        const a = found.get(id);
        if (!a || (a.uploaderUserId !== actor.userId && !inherited.has(id))) problems.push(`Attachment ${id} was not found or is not yours to use.`);
        else if (a.status !== "ready") problems.push(`Attachment ${id} is ${a.status}, not ready.`);
      }
      if (problems.length) return fail("invalid", "Some attachments cannot be used.", { errors: { attachmentIds: problems } });
      return ok(ids.map((id) => ({ id, altText: found.get(id)!.altText })));
    },

    /** Ready attachments among `ids`, with alt text, for the Markdown renderer. Unknown or unready IDs are left out. */
    async renderable(ids: readonly string[]): Promise<RenderableAttachment[]> {
      if (ids.length === 0) return [];
      return (await repo.getMany(ids)).filter((a) => a.status === "ready").map((a) => ({ id: a.id, altText: a.altText }));
    },

    /**
     * Visibility check before serving bytes. Public while referenced by a current published version;
     * otherwise only editors, the owner, and the uploader can read it, never cached publicly. Null means 404.
     */
    async open(viewer: ViewerLike, id: string) {
      if (!ATTACHMENT_ID_PATTERN.test(id)) return null;
      const a = await repo.get(id);
      if (!a || a.status !== "ready") return null;
      let visibility: "public" | "private";
      if (await repo.isPubliclyVisible(id)) visibility = "public";
      else if (viewer && viewer.status === "active" && (hasRole(viewer, "editor") || viewer.userId === a.uploaderUserId)) visibility = "private";
      else return null;
      const object = await storage.get(a.storageKey);
      if (!object) return null;
      return {
        body: object.body,
        contentType: a.mimeType,
        size: object.size,
        visibility,
        cacheControl: visibility === "public" ? "public, max-age=300" : "private, no-store",
      };
    },

    /** Owner-run cleanup of uploads that nothing references and that are older than seven days. */
    async cleanupUnreferenced(viewer: ViewerLike): Promise<Result<{ deleted: number }>> {
      if (!viewer || !hasRole(viewer, "owner")) return fail("forbidden", "Only the owner can clean up uploads.");
      const cutoff = new Date(now().getTime() - CLEANUP_MIN_AGE_DAYS * 24 * 60 * 60 * 1000);
      const candidates = await repo.listUnreferencedBefore(cutoff, 500);
      const deleted = await repo.deleteIfUnreferenced(candidates.map((a) => a.id));
      const keys = new Map(candidates.map((a) => [a.id, a.storageKey]));
      for (const id of deleted) {
        try {
          await storage.delete(keys.get(id)!);
        } catch (error) {
          console.error(JSON.stringify({ event: "attachment_delete_failed", attachmentId: id, error: String(error) }));
        }
      }
      await audit.record({ kind: "member", userId: viewer.userId }, "attachment.cleanup", undefined, { deleted: deleted.length });
      return ok({ deleted: deleted.length });
    },
  };
}
