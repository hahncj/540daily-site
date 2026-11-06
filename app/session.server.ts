import type { Services } from "../server/app";
import type { Viewer } from "../server/core/access";

/**
 * The signed-in member, or null. Reads the Better Auth session, then the member's current
 * role and status from the database on every request, so role changes and disabling apply at once.
 */
export async function getViewer(request: Request, services: Services): Promise<Viewer | null> {
  const session = await services.auth.api.getSession({ headers: request.headers });
  if (!session) return null;
  return services.members.getActive(session.user.id);
}
