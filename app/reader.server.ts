import { data } from "react-router";
import type { Services } from "../server/app";
import type { Viewer } from "../server/core/access";
import { requireRoleWrite } from "./access.server";
import { getViewer } from "./session.server";

/**
 * requireRoleWrite for reader actions that bookmark buttons and the theme switcher call with fetchers.
 * A refusal (signed out, cross-site) is returned as `{ ok: false, message }` data with its status instead of
 * thrown, so the control shows an inline message instead of replacing the page with the error screen.
 */
export async function readerWrite(request: Request, services: Services): Promise<{ viewer: Viewer } | { refused: ReturnType<typeof refusal> }> {
  try {
    return { viewer: await requireRoleWrite(request, services, "reader") };
  } catch (thrown) {
    if (thrown instanceof Response) return { refused: refusal(await thrown.text(), thrown.status) };
    throw thrown;
  }
}

function refusal(message: string, status: number) {
  return data({ ok: false as const, message: message || "You can't do that.", focus: null }, { status });
}

/**
 * Which of these publications the signed-in member has saved, for list save buttons.
 * Null when signed out (no buttons are shown). Only the member's own bookmarks are read.
 */
export async function savedIdsFor(request: Request, services: Services, publicationIds: readonly string[]): Promise<string[] | null> {
  const viewer = await getViewer(request, services);
  if (!viewer) return null;
  return [...(await services.bookmarks.savedAmong(viewer.userId, publicationIds))];
}
