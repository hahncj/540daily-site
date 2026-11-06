import type { Services } from "../server/app";
import type { Viewer } from "../server/core/access";

/** A signed-in member, plus their Google profile picture URL for display. */
export type SessionViewer = Viewer & { image: string | null };

/**
 * The signed-in member, or null. Reads the Better Auth session, then the member's current
 * role and status from the database on every request, so role changes and disabling apply at once.
 */
export async function getViewer(request: Request, services: Services): Promise<SessionViewer | null> {
  const session = await services.auth.api.getSession({ headers: request.headers });
  if (!session) return null;
  const viewer = await services.members.getActive(session.user.id);
  return viewer ? { ...viewer, image: session.user.image ?? null } : null;
}
