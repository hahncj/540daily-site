// Media routes. Lane 2A: the attachment upload endpoint (`PUT /api/v1/uploads/:token`).
// Lane 2B: `GET|HEAD /attachments/:id` serving with a visibility check.
import { eq } from "drizzle-orm";
import type { Services } from "./app";
import { sha256Hex } from "./core/hash";
import { uploadTickets } from "./db/schema";
import { MAX_ATTACHMENT_BYTES } from "./core/attachments";
import { attachmentJson, errorResult, failureResult, logOperation, UPLOAD_PATH_PREFIX, type OperationResult } from "./integration";

const NO_STORE = { "Cache-Control": "no-store" };

/** The member a ticket belongs to, for the operation log only. Null when unknown. */
async function ticketOwner(services: Services, token: string): Promise<string | null> {
  if (!token || token.length > 128) return null;
  try {
    const [row] = await services.db.select({ userId: uploadTickets.userId }).from(uploadTickets).where(eq(uploadTickets.tokenHash, await sha256Hex(token))).limit(1);
    return row?.userId ?? null;
  } catch {
    return null;
  }
}

/** True for the upload URL path that `prepare_attachment_upload` returns. */
export function isUploadPath(path: string) {
  return path.startsWith(UPLOAD_PATH_PREFIX);
}

/**
 * Finish an upload: `PUT <uploadUrl>` with the raw image bytes. The URL's single-use ticket is the only
 * credential; it is bound to the member, MIME type, and declared size. Core checks the size and the
 * file signature, stores the bytes in the private bucket, and marks the attachment ready.
 */
export async function handleUpload(request: Request, services: Services): Promise<Response> {
  const started = Date.now();
  const operationId = services.newId();
  const path = new URL(request.url).pathname;
  let result: OperationResult;
  let uploaderUserId: string | null = null;
  if (request.method !== "PUT") {
    result = errorResult(405, "method_not_allowed", "Upload the file with PUT.");
  } else {
    let token = "";
    try {
      token = decodeURIComponent(path.slice(UPLOAD_PATH_PREFIX.length));
    } catch {
      token = "";
    }
    uploaderUserId = await ticketOwner(services, token);
    const declared = Number(request.headers.get("content-length"));
    const body = Number.isFinite(declared) && declared > MAX_ATTACHMENT_BYTES ? null : await readBodyAtMost(request, MAX_ATTACHMENT_BYTES);
    if (!body || body.overflow) {
      // Refused without buffering it; the ticket stays unused so the right file can still be sent.
      result = errorResult(413, "too_large", "Attachments can be at most 10 MiB.");
    } else {
      // Core rejects anything over the size declared for this ticket.
      const out = await services.attachments.completeUpload(token, body.bytes);
      result = out.ok
        ? { httpStatus: 200, isError: false, body: { status: "uploaded", message: "Uploaded. Reference it in Markdown.", attachment: attachmentJson(out.value) } }
        : failureResult(out);
    }
  }
  logOperation({
    operationId,
    interface: "http",
    operation: "complete_attachment_upload",
    userId: uploaderUserId,
    credentialKind: null,
    credentialId: null,
    status: result.body.status,
    httpStatus: result.httpStatus,
    durationMs: Date.now() - started,
  });
  const headers: Record<string, string> = { ...NO_STORE };
  if (result.httpStatus === 405) headers.Allow = "PUT";
  return Response.json(result.body, { status: result.httpStatus, headers });
}

/**
 * Read the body without buffering more than `limit` bytes. `overflow` is true when the body is longer;
 * reading stops there. Shared by the JSON API and the upload endpoint.
 */
export async function readBodyAtMost(request: Request, limit: number): Promise<{ bytes: Uint8Array; overflow: boolean }> {
  if (!request.body) return { bytes: new Uint8Array(0), overflow: false };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > limit) {
      await reader.cancel().catch(() => undefined);
      return { bytes: new Uint8Array(0), overflow: true };
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return { bytes, overflow: false };
}

export const ATTACHMENTS_PREFIX = "/attachments/";


function notFound() {
  return Response.json({ status: "not_found", message: "Not found." }, { status: 404, headers: NO_STORE });
}

/** The signed-in active member, or null. Only looked up when the request carries a cookie. */
async function viewerFor(request: Request, services: Services) {
  if (!request.headers.get("cookie")) return null;
  const session = await services.auth.api.getSession({ headers: request.headers });
  return session ? services.members.getActive(session.user.id) : null;
}

/**
 * `GET|HEAD /attachments/:id`. Public while the attachment is referenced by a current published version
 * (short public cache); otherwise only editors, the owner, and the uploader get it, never cached.
 * Everyone else gets the same 404 as for an unknown ID, so private attachments do not reveal they exist.
 */
export async function serveAttachment(request: Request, services: Services): Promise<Response> {
  const path = new URL(request.url).pathname;
  let id: string;
  try {
    id = decodeURIComponent(path.slice(ATTACHMENTS_PREFIX.length));
  } catch {
    return notFound();
  }
  const viewer = await viewerFor(request, services);
  const opened = await services.attachments.open(viewer, id);
  if (!opened) return notFound();

  const headers = new Headers({
    "Content-Type": opened.contentType,
    "Content-Length": String(opened.size),
    "Cache-Control": opened.cacheControl,
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  });
  if (opened.visibility === "private") {
    // A private response depends on who is signed in, and is never embedded by other sites.
    headers.set("Vary", "Cookie");
    headers.set("Cross-Origin-Resource-Policy", "same-origin");
  }

  if (request.method === "HEAD") {
    await opened.body.cancel();
    return new Response(null, { status: 200, headers });
  }
  return new Response(opened.body, { status: 200, headers });
}
