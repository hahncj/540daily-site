import type { Services } from "../server/app";
import type { Viewer } from "../server/core/access";
import type { Category, Tag } from "../server/core/categories";

/**
 * The panels a home page shows. Visitors, and members who never saved their own layout, get the
 * public homepage layout. A member's saved layout replaces it. Interest tags filter either one.
 */
export async function homeLayout(
  services: Services,
  viewer: Viewer | null,
): Promise<{ panels: Category[]; personal: boolean; interestTags: Tag[] }> {
  const prefs = viewer ? await services.preferences.home(viewer.userId) : { panels: null, interestTags: [] };
  const panels = prefs.panels ?? (await services.homepage.layout()).map(({ id, name, slug }) => ({ id, name, slug }));
  return { panels, personal: prefs.panels !== null, interestTags: prefs.interestTags };
}

/** Categories a member may add to their home page: those with published content, plus those on the public homepage. */
export async function addableCategories(services: Services): Promise<Category[]> {
  const [withPublished, layout] = await Promise.all([services.categories.listWithPublished(), services.homepage.layout()]);
  const out = new Map<string, Category>();
  for (const c of [...withPublished, ...layout]) out.set(c.id, { id: c.id, name: c.name, slug: c.slug });
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}
