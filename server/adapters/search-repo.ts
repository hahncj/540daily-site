// FTS5 search over current published publications. The virtual table and its triggers are created by
// migration 0001; it is declared here only for queries, so drizzle-kit never tries to manage it.
import { and, desc, eq, gte, lt, or, sql } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { SearchRepository } from "../core/search";
import { categories, publications } from "../db/schema";
import type { Database } from "./db";
import { selectListRows, withTags, type ListRow } from "./publication-rows";

const publicationsFts = sqliteTable("publications_fts", {
  publicationId: text("publication_id").notNull(),
  title: text("title"),
  summary: text("summary"),
  body: text("body"),
});

export function createSearchRepository(db: Database): SearchRepository {
  return {
    async search({ match, categoryId, type, from, toExclusive, includeOwnFor, limit, offset }) {
      // The FTS index holds only published rows, so a keyword never matches drafts, unpublished items,
      // or old revisions. `includeOwnFor` widens unfiltered browsing to the member's own items.
      const visible = includeOwnFor
        ? or(eq(publications.status, "published"), eq(publications.createdByUserId, includeOwnFor))
        : eq(publications.status, "published");
      const where = and(
        visible,
        categoryId ? eq(publications.categoryId, categoryId) : undefined,
        type ? eq(publications.type, type) : undefined,
        from ? gte(publications.publishedAt, from) : undefined,
        toExclusive ? lt(publications.publishedAt, toExclusive) : undefined,
        match ? sql`${publicationsFts} match ${match}` : undefined,
      );

      if (match) {
        const [rows, [count]] = await Promise.all([
          selectListRows(db)
            .innerJoin(publicationsFts, eq(publicationsFts.publicationId, publications.id))
            .where(where)
            .orderBy(sql`bm25(${publicationsFts})`, desc(publications.publishedAt), desc(publications.id))
            .limit(limit)
            .offset(offset),
          db
            .select({ n: sql<number>`count(*)` })
            .from(publications)
            .innerJoin(publicationsFts, eq(publicationsFts.publicationId, publications.id))
            .where(where),
        ]);
        return { items: await withTags(db, rows as unknown as ListRow[]), total: Number(count?.n ?? 0) };
      }

      const [rows, [count]] = await Promise.all([
        selectListRows(db).where(where).orderBy(desc(publications.publishedAt), desc(publications.id)).limit(limit).offset(offset),
        db.select({ n: sql<number>`count(*)` }).from(publications).where(where),
      ]);
      return { items: await withTags(db, rows as ListRow[]), total: Number(count?.n ?? 0) };
    },

    async categoryIdForSlug(slug) {
      const rows = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug)).limit(1);
      return rows[0]?.id ?? null;
    },
  };
}
