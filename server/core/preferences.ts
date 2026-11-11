// Reader preferences: personal home page panels (choice and order), explicit interest tags, and theme.
// A member sees the public homepage layout until they first change their panels; only then is a
// personal layout saved. Later public layout changes never overwrite a saved personal layout.
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
  /** True once the member has saved their own panel layout (until they reset it). */
  hasPersonalLayout(userId: string): Promise<boolean>;
  /** The member's saved panels, in order. */
  panels(userId: string): Promise<Category[]>;
  /** Replace the member's panels in one transaction and mark the personal layout saved. */
  replacePanels(userId: string, categoryIds: readonly string[], now: Date): Promise<void>;
  /** Delete the member's saved panels in one transaction, so they follow the public layout again. */
  clearPanels(userId: string, now: Date): Promise<void>;
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

    /**
     * The member's home page preferences. `panels` is null when they never saved their own layout:
     * the caller then shows the current public homepage layout.
     */
    async home(userId: string): Promise<{ panels: Category[] | null; interestTags: Tag[] }> {
      const [personal, interestTags] = await Promise.all([repo.hasPersonalLayout(userId), repo.interestTags(userId)]);
      return { panels: personal ? await repo.panels(userId) : null, interestTags };
    },

    /** Forget the member's own layout; their home page follows the public layout again. Interests are kept. */
    async resetPanels(userId: string): Promise<void> {
      await repo.clearPanels(userId, now());
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
