// Reader preferences: personal dashboard panels (choice and order), explicit interest tags, and theme.
// Every method takes the signed-in member's own user ID; callers never pass another member's ID.
import type { Category, Tag } from "./categories";
import { MAX_HOMEPAGE_PANELS } from "./categories";
import { fail, ok, type Result } from "./result";

export const THEME_CHOICES = ["system", "light", "dark"] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

export const MAX_DASHBOARD_PANELS = MAX_HOMEPAGE_PANELS;
export const MAX_INTEREST_TAGS = 50;

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === "string" && (THEME_CHOICES as readonly string[]).includes(value);
}

export interface PreferencesRepository {
  /** The member's saved theme, or null when nothing is saved. */
  getTheme(userId: string): Promise<ThemeChoice | null>;
  setTheme(userId: string, theme: ThemeChoice, now: Date): Promise<void>;
  /**
   * One transaction: if the member's dashboard was never set up, copy the current public homepage
   * layout into it and mark it set up. Does nothing afterwards, so later public changes never overwrite it.
   */
  seedFromHomepage(userId: string, now: Date): Promise<void>;
  /** The member's dashboard panels, in order. */
  panels(userId: string): Promise<Category[]>;
  /** Replace the member's panels in one transaction and mark the dashboard set up. */
  replacePanels(userId: string, categoryIds: readonly string[], now: Date): Promise<void>;
  interestTags(userId: string): Promise<Tag[]>;
  replaceInterestTags(userId: string, tagIds: readonly string[], now: Date): Promise<void>;
}

/** Lookups the service uses to check that chosen categories and tags exist. */
export interface PreferenceLookups {
  categoriesByIds(ids: readonly string[]): Promise<Category[]>;
  tagsByIds(ids: readonly string[]): Promise<Tag[]>;
}

export type Preferences = ReturnType<typeof createPreferences>;

export function createPreferences({ repo, lookups, now }: { repo: PreferencesRepository; lookups: PreferenceLookups; now: () => Date }) {
  return {
    /** "system" (follow the device) when the member never chose. */
    async theme(userId: string): Promise<ThemeChoice> {
      return (await repo.getTheme(userId)) ?? "system";
    },

    async setTheme(userId: string, theme: unknown): Promise<Result<ThemeChoice>> {
      if (!isThemeChoice(theme)) return fail("invalid", "Choose device, light, or dark.");
      await repo.setTheme(userId, theme, now());
      return ok(theme);
    },

    /** The personal dashboard: panels in order (seeded from the public layout on first use) and interest tags. */
    async dashboard(userId: string): Promise<{ panels: Category[]; interestTags: Tag[] }> {
      await repo.seedFromHomepage(userId, now());
      const [panels, interestTags] = await Promise.all([repo.panels(userId), repo.interestTags(userId)]);
      return { panels, interestTags };
    },

    async setPanels(userId: string, categoryIds: readonly string[]): Promise<Result<Category[]>> {
      if (categoryIds.length > MAX_DASHBOARD_PANELS) return fail("invalid", `At most ${MAX_DASHBOARD_PANELS} panels.`);
      if (new Set(categoryIds).size !== categoryIds.length) return fail("invalid", "Each category can appear once.");
      const found = await lookups.categoriesByIds(categoryIds);
      if (found.length !== categoryIds.length) return fail("invalid", "Unknown category.");
      await repo.replacePanels(userId, categoryIds, now());
      return ok(await repo.panels(userId));
    },

    /** The member's selected interest tags. */
    interestTags: (userId: string): Promise<Tag[]> => repo.interestTags(userId),

    async setInterestTags(userId: string, tagIds: readonly string[]): Promise<Result<Tag[]>> {
      const unique = [...new Set(tagIds)];
      if (unique.length > MAX_INTEREST_TAGS) return fail("invalid", `Choose at most ${MAX_INTEREST_TAGS} interests.`);
      const found = await lookups.tagsByIds(unique);
      if (found.length !== unique.length) return fail("invalid", "Unknown interest tag.");
      await repo.replaceInterestTags(userId, unique, now());
      return ok(await repo.interestTags(userId));
    },
  };
}
