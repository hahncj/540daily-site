import { asc, eq, inArray, sql } from "drizzle-orm";
import type { CategoriesRepository, TagsRepository } from "../core/categories";
import { categories, homepagePanels, publications, publicationTags, tags } from "../db/schema";
import { atomic } from "./atomic";
import type { Database } from "./db";

const categoryColumns = { id: categories.id, name: categories.name, slug: categories.slug };
const tagColumns = { id: tags.id, name: tags.name, slug: tags.slug };

export function createCategoriesRepository(db: Database): CategoriesRepository {
  return {
    listAll: () => db.select(categoryColumns).from(categories).orderBy(asc(categories.normalizedName)),

    async listWithPublished() {
      const rows = await db
        .select({ ...categoryColumns, publishedCount: sql<number>`count(${publications.id})` })
        .from(categories)
        .innerJoin(publications, eq(publications.categoryId, categories.id))
        .where(eq(publications.status, "published"))
        .groupBy(categories.id)
        .orderBy(asc(categories.normalizedName));
      return rows.map((r) => ({ ...r, publishedCount: Number(r.publishedCount) }));
    },

    async getBySlug(slug) {
      const rows = await db.select(categoryColumns).from(categories).where(eq(categories.slug, slug)).limit(1);
      return rows[0] ?? null;
    },

    async getByIds(ids) {
      if (ids.length === 0) return [];
      return db.select(categoryColumns).from(categories).where(inArray(categories.id, [...ids]));
    },

    homepageLayout: () =>
      db
        .select(categoryColumns)
        .from(homepagePanels)
        .innerJoin(categories, eq(categories.id, homepagePanels.categoryId))
        .orderBy(asc(homepagePanels.position), asc(categories.normalizedName)),

    async replaceHomepageLayout(categoryIds, userId, now) {
      await atomic(db, [
        () => db.delete(homepagePanels),
        ...categoryIds.map(
          (categoryId, position) => () => db.insert(homepagePanels).values({ categoryId, position, updatedAt: now, updatedByUserId: userId }),
        ),
      ]);
    },
  };
}

export function createTagsRepository(db: Database): TagsRepository {
  return {
    async listWithPublished() {
      const rows = await db
        .select({ ...tagColumns, publishedCount: sql<number>`count(${publications.id})` })
        .from(tags)
        .innerJoin(publicationTags, eq(publicationTags.tagId, tags.id))
        .innerJoin(publications, eq(publications.id, publicationTags.publicationId))
        .where(eq(publications.status, "published"))
        .groupBy(tags.id)
        .orderBy(asc(tags.normalizedName));
      return rows.map((r) => ({ ...r, publishedCount: Number(r.publishedCount) }));
    },

    async getByIds(ids) {
      if (ids.length === 0) return [];
      return db.select(tagColumns).from(tags).where(inArray(tags.id, [...ids]));
    },
  };
}
