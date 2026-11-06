import { redirect } from "react-router";
import type { Services } from "../server/app";
import { hasRole, type Role, type Viewer } from "../server/core/access";
import { isSameOriginWrite } from "../server/same-origin";
import { getViewer } from "./session.server";

/** For GET pages: signed-out visitors go to sign-in; members without the role get 403. */
export async function requireRolePage(request: Request, services: Services, min: Role): Promise<Viewer> {
  const viewer = await getViewer(request, services);
  if (viewer && hasRole(viewer, min)) return viewer;
  if (viewer) throw new Response("You don't have access to this page.", { status: 403 });
  const url = new URL(request.url);
  throw redirect(`/sign-in?next=${encodeURIComponent(url.pathname + url.search)}`);
}

/** First line of every write action: same-origin check, then role. 401 signed out, 403 without the role. */
export async function requireRoleWrite(request: Request, services: Services, min: Role): Promise<Viewer> {
  assertSameOrigin(request, services);
  const viewer = await getViewer(request, services);
  if (viewer && hasRole(viewer, min)) return viewer;
  throw new Response(viewer ? "You don't have access to do that." : "Sign in to do that.", { status: viewer ? 403 : 401 });
}

export function assertSameOrigin(request: Request, services: Services) {
  if (!isSameOriginWrite(request, services.config.baseUrl)) {
    throw new Response("This request did not come from 540 News.", { status: 403 });
  }
}

/** A `next=` return path is accepted only as a same-site relative path. */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  try {
    const url = new URL(next, "http://same.invalid");
    if (url.origin !== "http://same.invalid") return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
