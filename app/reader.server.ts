import type { Services } from "../server/app";
import { getViewer } from "./session.server";

/**
 * Which of these publications the signed-in member has saved, for list save buttons.
 * Null when signed out (no buttons are shown). Only the member's own bookmarks are read.
 */
export async function savedIdsFor(request: Request, services: Services, publicationIds: readonly string[]): Promise<string[] | null> {
  const viewer = await getViewer(request, services);
  if (!viewer) return null;
  return [...(await services.bookmarks.savedAmong(viewer.userId, publicationIds))];
}
