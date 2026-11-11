// Drizzle repositories for reader preferences and bookmarks. Every query is filtered by the member's user ID.
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { BookmarksRepository } from "../core/bookmarks";
import type { PreferencesRepository } from "../core/preferences";
import { bookmarks, categories, homepagePanels, publications, tags, userCategoryPanels, userInterestTags, userPreferences } from "../db/schema";
import { atomic } from "./atomic";
import type { Database } from "./db";
import { inList } from "./in-list";
import { selectListRows, withTags, type ListRow } from "./publication-rows";

export function createPreferencesRepository(db: Database): PreferencesRepository {
  /** Create the preferences row if missing and mark the dashboard set up; keeps the theme and first set-up time. */
  const markInitialized = (userId: string, now: Date) => () =>
    db
      .insert(userPreferences)
      .values({ userId, layoutInitializedAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: { layoutInitializedAt: sql`coalesce(${userPreferences.layoutInitializedAt}, excluded.layout_initialized_at)`, updatedAt: now },
      });

  return {
    async getTheme(userId) {
      const rows = await db.select({ theme: userPreferences.theme }).from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1);
      return rows[0]?.theme ?? null;
    },

    async setTheme(userId, theme, now) {
      await db
        .insert(userPreferences)
        .values({ userId, theme, updatedAt: now })
        .onConflictDoUpdate({ target: userPreferences.userId, set: { theme, updatedAt: now } });
    },

    async seedFromHomepage(userId, now) {
      // Cheap read first: most visits find the dashboard already set up.
      const rows = await db
        .select({ at: userPreferences.layoutInitializedAt })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .limit(1);
      if (rows[0]?.at) return;
      // Both statements re-check inside the transaction, so two first visits at once seed only once.
      await atomic(db, [
        () =>
          db.run(sql`insert or ignore into ${userCategoryPanels} (user_id, category_id, position)
            select ${userId}, ${homepagePanels.categoryId}, ${homepagePanels.position} from ${homepagePanels}
            where not exists (select 1 from ${userPreferences} where ${userPreferences.userId} = ${userId} and ${userPreferences.layoutInitializedAt} is not null)`),
        markInitialized(userId, now),
      ]);
    },

    panels: (userId) =>
      db
        .select({ id: categories.id, name: categories.name, slug: categories.slug })
        .from(userCategoryPanels)
        .innerJoin(categories, eq(categories.id, userCategoryPanels.categoryId))
        .where(eq(userCategoryPanels.userId, userId))
        .orderBy(asc(userCategoryPanels.position), asc(categories.normalizedName)),

    async replacePanels(userId, categoryIds, now) {
      await atomic(db, [
        () => db.delete(userCategoryPanels).where(eq(userCategoryPanels.userId, userId)),
        ...categoryIds.map((categoryId, position) => () => db.insert(userCategoryPanels).values({ userId, categoryId, position })),
        markInitialized(userId, now),
      ]);
    },

    interestTags: (userId) =>
      db
        .select({ id: tags.id, name: tags.name, slug: tags.slug })
        .from(userInterestTags)
        .innerJoin(tags, eq(tags.id, userInterestTags.tagId))
        .where(eq(userInterestTags.userId, userId))
        .orderBy(asc(tags.normalizedName)),

    async replaceInterestTags(userId, tagIds, now) {
      await atomic(db, [
        () => db.delete(userInterestTags).where(eq(userInterestTags.userId, userId)),
        ...tagIds.map((tagId) => () => db.insert(userInterestTags).values({ userId, tagId })),
        () =>
          db
            .insert(userPreferences)
            .values({ userId, updatedAt: now })
            .onConflictDoUpdate({ target: userPreferences.userId, set: { updatedAt: now } }),
      ]);
    },
  };
}

export function createBookmarksRepository(db: Database): BookmarksRepository {
  return {
    async isPublished(publicationId) {
      const rows = await db
        .select({ id: publications.id })
        .from(publications)
        .where(and(eq(publications.id, publicationId), eq(publications.status, "published")))
        .limit(1);
      return rows.length > 0;
    },

    async count(userId) {
      const [row] = await db.select({ n: sql<number>`count(*)` }).from(bookmarks).where(eq(bookmarks.userId, userId));
      return Number(row?.n ?? 0);
    },

    async add(userId, publicationId, now) {
      await db.insert(bookmarks).values({ userId, publicationId, createdAt: now }).onConflictDoNothing();
    },

    async remove(userId, publicationId) {
      await db.delete(bookmarks).where(and(eq(bookmarks.userId, userId), eq(bookmarks.publicationId, publicationId)));
    },

    async list(userId, limit, offset) {
      const where = eq(bookmarks.userId, userId);
      const [saved, [count]] = await Promise.all([
        db
          .select({ publicationId: bookmarks.publicationId, savedAt: bookmarks.createdAt })
          .from(bookmarks)
          .where(where)
          .orderBy(desc(bookmarks.createdAt), desc(bookmarks.publicationId))
          .limit(limit)
          .offset(offset),
        db.select({ n: sql<number>`count(*)` }).from(bookmarks).where(where),
      ]);
      const ids = saved.map((s) => s.publicationId);
      // Only published rows are read, so nothing about unpublished items or drafts reaches the caller.
      const rows =
        ids.length === 0
          ? []
          : await selectListRows(db).where(and(inList(publications.id, ids), eq(publications.status, "published")));
      const items = new Map((await withTags(db, rows as ListRow[])).map((item) => [item.id, item]));
      return {
        entries: saved.map((s) => ({ publicationId: s.publicationId, savedAt: s.savedAt, item: items.get(s.publicationId) ?? null })),
        total: Number(count?.n ?? 0),
      };
    },

    async savedAmong(userId, publicationIds) {
      if (publicationIds.length === 0) return new Set();
      const rows = await db
        .select({ id: bookmarks.publicationId })
        .from(bookmarks)
        .where(and(eq(bookmarks.userId, userId), inList(bookmarks.publicationId, [...publicationIds])));
      return new Set(rows.map((r) => r.id));
    },
  };
}
