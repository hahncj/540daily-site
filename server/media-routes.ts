// Attachment HTTP routes. Lane 2B owns `GET|HEAD /attachments/:id` (serving with a visibility check);
// lane 2A owns the upload endpoints.
import type { Services } from "./app";

export const ATTACHMENTS_PREFIX = "/attachments/";

const NOT_FOUND_HEADERS = { "Cache-Control": "no-store" };

function notFound() {
  return Response.json({ status: "not_found", message: "Not found." }, { status: 404, headers: NOT_FOUND_HEADERS });
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
