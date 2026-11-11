// Categories, tags, and the editor-managed public homepage layout.
// Categories are created automatically from publications. Home pages show a category whenever it has
// recent published items; the editor's layout (and a member's own panels) only set the preferred order.
import { canEdit, type Actor } from "./actors";
import type { Audit } from "./audit";
import { fail, ok, type Result } from "./result";

export type Category = { id: string; name: string; slug: string };
export type CategoryWithCount = Category & { publishedCount: number };
export type Tag = { id: string; name: string; slug: string };
export type TagWithCount = Tag & { publishedCount: number };

export interface CategoriesRepository {
  listAll(): Promise<Category[]>;
  /** Categories with at least one published publication, with that count, by name. */
  listWithPublished(): Promise<CategoryWithCount[]>;
  getBySlug(slug: string): Promise<Category | null>;
  getByIds(ids: readonly string[]): Promise<Category[]>;
  /** Homepage panels in order. */
  homepageLayout(): Promise<Category[]>;
  /** Replace the homepage layout in one transaction. */
  replaceHomepageLayout(categoryIds: readonly string[], userId: string, now: Date): Promise<void>;
}

export interface TagsRepository {
  /** Tags used by at least one published publication (for interest filters), by name. */
  listWithPublished(): Promise<TagWithCount[]>;
  getByIds(ids: readonly string[]): Promise<Tag[]>;
}

export const MAX_HOMEPAGE_PANELS = 50;

/**
 * Home page panels from a preferred order and the categories with recent items. Preferred categories
 * that have recent items come first, in the preferred order; every other category with recent items
 * follows in `recent`'s order (newest item first). Preferred categories with nothing recent are left
 * out. At most `max` panels.
 */
export function arrangePanels<T extends { category: Category }>(
  preferred: readonly Category[],
  recent: ReadonlyMap<string, readonly T[]>,
  max = MAX_HOMEPAGE_PANELS,
): { category: Category; items: T[] }[] {
  const out: { category: Category; items: T[] }[] = [];
  const placed = new Set<string>();
  for (const category of preferred) {
    const items = recent.get(category.id);
    if (!items?.length || placed.has(category.id)) continue;
    placed.add(category.id);
    out.push({ category, items: [...items] });
  }
  for (const [id, items] of recent) {
    if (placed.has(id) || !items.length) continue;
    placed.add(id);
    const { name, slug } = items[0]!.category;
    out.push({ category: { id, name, slug }, items: [...items] });
  }
  return out.slice(0, max);
}

export type Categories = ReturnType<typeof createCategories>;
export type Homepage = ReturnType<typeof createHomepage>;
export type Tags = ReturnType<typeof createTags>;

export function createCategories({ repo }: { repo: CategoriesRepository }) {
  return {
    listAll: () => repo.listAll(),
    /** `/categories`: every category with published content, including those absent from the homepage. */
    listWithPublished: () => repo.listWithPublished(),
    getBySlug: (slug: string) => repo.getBySlug(slug),
  };
}

export function createTags({ repo }: { repo: TagsRepository }) {
  return {
    listWithPublished: () => repo.listWithPublished(),
    getByIds: (ids: readonly string[]) => repo.getByIds(ids),
  };
}

/** Move one category up or down in an ordered list. Pure helper for move-up/down buttons. */
export function moveCategory(order: readonly string[], categoryId: string, direction: "up" | "down"): string[] {
  const next = [...order];
  const i = next.indexOf(categoryId);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= next.length) return next;
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

export function createHomepage({ repo, audit, now }: { repo: CategoriesRepository; audit: Audit; now: () => Date }) {
  return {
    /** The public homepage panels, in order. */
    layout: () => repo.homepageLayout(),

    /** Editors choose and order the public homepage categories. Agents never can. */
    async setLayout(actor: Actor, categoryIds: readonly string[]): Promise<Result<Category[]>> {
      if (!canEdit(actor)) return fail("forbidden", "Only editors can change the homepage layout.");
      if (categoryIds.length > MAX_HOMEPAGE_PANELS) return fail("invalid", `At most ${MAX_HOMEPAGE_PANELS} homepage panels.`);
      if (new Set(categoryIds).size !== categoryIds.length) return fail("invalid", "Each category can appear once.");
      const found = await repo.getByIds(categoryIds);
      if (found.length !== categoryIds.length) return fail("invalid", "Unknown category.");
      await repo.replaceHomepageLayout(categoryIds, actor.userId, now());
      await audit.record(actor, "homepage.update", { type: "homepage", id: "public" }, { panels: categoryIds.length });
      return ok(await repo.homepageLayout());
    },
  };
}
