import type { Services } from "../server/app";
import type { Viewer } from "../server/core/access";
import type { Category, Tag } from "../server/core/categories";
import { DEFAULT_HOME_WINDOW_HOURS, type HomeWindowHours } from "../server/core/preferences";

/**
 * The preferred panel order and filters for a home page. Visitors, and members who never saved their
 * own layout, get the public homepage order. A member's saved order replaces it. Interest tags filter
 * either one. `windowHours` is how far back the home page looks (24 hours for visitors).
 * Which panels actually show depends on recent content: see `arrangePanels`.
 */
export async function homeLayout(
  services: Services,
  viewer: Viewer | null,
): Promise<{ panels: Category[]; personal: boolean; interestTags: Tag[]; windowHours: HomeWindowHours }> {
  const prefs = viewer
    ? await services.preferences.home(viewer.userId)
    : { panels: null, interestTags: [], windowHours: DEFAULT_HOME_WINDOW_HOURS };
  const panels = prefs.panels ?? (await services.homepage.layout()).map(({ id, name, slug }) => ({ id, name, slug }));
  return { panels, personal: prefs.panels !== null, interestTags: prefs.interestTags, windowHours: prefs.windowHours };
}

/** Categories a member may add to their home page: those with published content, plus those on the public homepage. */
export async function addableCategories(services: Services): Promise<Category[]> {
  const [withPublished, layout] = await Promise.all([services.categories.listWithPublished(), services.homepage.layout()]);
  const out = new Map<string, Category>();
  for (const c of [...withPublished, ...layout]) out.set(c.id, { id: c.id, name: c.name, slug: c.slug });
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}
