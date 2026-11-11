// Shared read helpers for publication list items (used by the publications and search repositories).
import { asc, eq } from "drizzle-orm";
import type { Tag } from "../core/categories";
import type { PublicationListItem } from "../core/publications";
import { categories, publications, publicationTags, tags, user } from "../db/schema";
import type { Database } from "./db";
import { inList } from "./in-list";

export const listColumns = {
  id: publications.id,
  type: publications.type,
  title: publications.title,
  summary: publications.summary,
  status: publications.status,
  revision: publications.revision,
  createdAt: publications.createdAt,
  publishedAt: publications.publishedAt,
  updatedAt: publications.updatedAt,
  createdByUserId: publications.createdByUserId,
  createdByKind: publications.createdByKind,
  createdByLabel: publications.createdByLabel,
  creatorName: user.name,
  categoryId: categories.id,
  categoryName: categories.name,
  categorySlug: categories.slug,
};

export type ListRow = {
  id: string;
  type: PublicationListItem["type"];
  title: string;
  summary: string;
  status: PublicationListItem["status"];
  revision: number;
  createdAt: Date;
  publishedAt: Date | null;
  updatedAt: Date;
  createdByUserId: string;
  createdByKind: "member" | "agent";
  createdByLabel: string | null;
  creatorName: string;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
};

/** Base select with the category and creator joined. */
export function selectListRows(db: Database) {
  return db
    .select(listColumns)
    .from(publications)
    .innerJoin(categories, eq(categories.id, publications.categoryId))
    .innerJoin(user, eq(user.id, publications.createdByUserId));
}

export async function tagsFor(db: Database, publicationIds: readonly string[]): Promise<Map<string, Tag[]>> {
  const out = new Map<string, Tag[]>();
  if (publicationIds.length === 0) return out;
  const rows = await db
    .select({ publicationId: publicationTags.publicationId, id: tags.id, name: tags.name, slug: tags.slug })
    .from(publicationTags)
    .innerJoin(tags, eq(tags.id, publicationTags.tagId))
    .where(inList(publicationTags.publicationId, [...publicationIds]))
    .orderBy(asc(tags.name));
  for (const r of rows) {
    const list = out.get(r.publicationId) ?? [];
    list.push({ id: r.id, name: r.name, slug: r.slug });
    out.set(r.publicationId, list);
  }
  return out;
}

export function toListItem(r: ListRow, tagList: Tag[]): PublicationListItem {
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    summary: r.summary,
    category: { id: r.categoryId, name: r.categoryName, slug: r.categorySlug },
    tags: tagList,
    status: r.status,
    revision: r.revision,
    createdBy: { userId: r.createdByUserId, name: r.creatorName, kind: r.createdByKind, label: r.createdByLabel },
    createdAt: r.createdAt,
    publishedAt: r.publishedAt,
    updatedAt: r.updatedAt,
  };
}

export async function withTags(db: Database, rows: ListRow[]): Promise<PublicationListItem[]> {
  const t = await tagsFor(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => toListItem(r, t.get(r.id) ?? []));
}
