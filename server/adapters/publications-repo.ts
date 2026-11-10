// Drizzle implementation of PublicationsRepository. Multi-statement writes go through atomic()
// (one D1 batch or one SQLite transaction). Statements in a batch cannot read each other's results,
// so later statements use subselects and are guarded by the new revision row's ID.
import { and, desc, eq, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import {
  fromSnapshot,
  toSnapshot,
  type ContentSnapshot,
  type Publication,
  type PublicationsRepository,
  type RevisionWrite,
} from "../core/publications";
import { attachmentReferences, categories, publicationRevisions, publications, publicationTags, submissionReceipts, tags, user } from "../db/schema";
import { atomic, changesOf } from "./atomic";
import type { Database } from "./db";
import { listColumns, selectListRows, tagsFor, toListItem, withTags, type ListRow } from "./publication-rows";
import { isConstraintError } from "./sql-errors";

const nameTable = { category: categories, tag: tags } as const;

/** `(select id from <table> where normalized_name = key collate nocase)`; null when missing, which fails NOT NULL. */
function idByName(kind: "category" | "tag", key: string): SQL<string> {
  const t = nameTable[kind];
  return sql<string>`(select ${t.id} from ${t} where ${t.normalizedName} = ${key} collate nocase)`;
}

function revisionExists(revisionId: string): SQL {
  return sql`exists (select 1 from ${publicationRevisions} where ${publicationRevisions.id} = ${revisionId})`;
}

export function createPublicationsRepository(db: Database): PublicationsRepository {
  function nameInserts(w: RevisionWrite) {
    return [
      ...(w.newCategory ? [() => db.insert(categories).values(w.newCategory!).onConflictDoNothing()] : []),
      ...w.newTags.map((t) => () => db.insert(tags).values(t).onConflictDoNothing()),
    ];
  }

  function revisionValues(w: RevisionWrite, revision: number) {
    return {
      id: w.revisionId,
      publicationId: w.publicationId,
      revision,
      snapshot: toSnapshot(w.content) as unknown as Record<string, unknown>,
      status: w.status,
      actorKind: w.actor.kind,
      actorUserId: w.actor.userId,
      actorCredentialId: w.actor.credentialId,
      actorLabel: w.actor.label,
      createdAt: w.at,
    };
  }

  const contentColumns = (w: RevisionWrite) => ({
    type: w.content.type,
    title: w.content.title,
    summary: w.content.summary,
    bodyMarkdown: w.content.bodyMarkdown,
    sources: w.content.sources,
    sourcePublishedAt: w.content.sourcePublishedAt,
    categoryId: idByName("category", w.categoryKey),
    status: w.status,
    publishedAt: w.publishedAt,
    updatedAt: w.at,
    updatedByUserId: w.actor.userId,
  });

  return {
    async get(id) {
      const rows = await db
        .select({
          ...listColumns,
          bodyMarkdown: publications.bodyMarkdown,
          sources: publications.sources,
          sourcePublishedAt: publications.sourcePublishedAt,
          snapshot: publicationRevisions.snapshot,
        })
        .from(publications)
        .innerJoin(categories, eq(categories.id, publications.categoryId))
        .innerJoin(user, eq(user.id, publications.createdByUserId))
        .leftJoin(publicationRevisions, and(eq(publicationRevisions.publicationId, publications.id), eq(publicationRevisions.revision, publications.revision)))
        .where(eq(publications.id, id))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      const tagMap = await tagsFor(db, [id]);
      const snapshot = row.snapshot as ContentSnapshot | null;
      const publication: Publication = {
        ...toListItem(row as ListRow, tagMap.get(id) ?? []),
        bodyMarkdown: row.bodyMarkdown,
        sources: row.sources,
        // Order comes from the current revision's snapshot; references hold the same set.
        attachmentIds: snapshot?.attachmentIds ?? [],
        sourcePublishedAt: row.sourcePublishedAt,
      };
      return publication;
    },

    async findReceipt(userId, externalId) {
      const rows = await db
        .select({ publicationId: submissionReceipts.publicationId, payloadHash: submissionReceipts.payloadHash })
        .from(submissionReceipts)
        .where(and(eq(submissionReceipts.userId, userId), eq(submissionReceipts.externalId, externalId)))
        .limit(1);
      return rows[0] ?? null;
    },

    async findNames(kind, keys) {
      const out = new Map<string, { id: string; slug: string }>();
      if (keys.length === 0) return out;
      const t = nameTable[kind];
      const rows = await db
        .select({ id: t.id, slug: t.slug, normalizedName: t.normalizedName })
        .from(t)
        .where(inArray(sql`${t.normalizedName} collate nocase`, [...keys]));
      for (const r of rows) out.set(r.normalizedName.toLowerCase(), { id: r.id, slug: r.slug });
      return out;
    },

    async slugsInUse(kind, bases) {
      if (bases.length === 0) return new Set();
      const t = nameTable[kind];
      // Slugs contain only [a-z0-9-], so LIKE wildcards cannot appear in a base.
      const rows = await db
        .select({ slug: t.slug })
        .from(t)
        .where(or(inArray(t.slug, [...bases]), ...bases.map((b) => sql`${t.slug} like ${`${b}-%`}`)));
      return new Set(rows.map((r) => r.slug));
    },

    async create(w, receipt) {
      const statements: Array<() => unknown> = [
        ...nameInserts(w),
        () =>
          db.insert(publications).values({
            id: w.publicationId,
            ...contentColumns(w),
            revision: 1,
            createdByUserId: w.actor.userId,
            createdByKind: w.actor.kind,
            createdByCredentialKind: w.actor.credentialKind,
            createdByCredentialId: w.actor.credentialId,
            createdByLabel: w.actor.label,
            createdAt: w.createdAt,
          }),
        () => db.insert(publicationRevisions).values(revisionValues(w, 1)),
        // A missing tag (slug race) makes tag_id NULL, failing NOT NULL and rolling everything back.
        ...w.tagKeys.map((key) => () => db.insert(publicationTags).values({ publicationId: w.publicationId, tagId: idByName("tag", key) })),
        ...w.content.attachmentIds.map(
          (attachmentId) => () => db.insert(attachmentReferences).values({ publicationId: w.publicationId, revision: 1, attachmentId }),
        ),
        ...(receipt
          ? [
              () =>
                db.insert(submissionReceipts).values({
                  id: receipt.id,
                  userId: receipt.userId,
                  externalId: receipt.externalId,
                  payloadHash: receipt.payloadHash,
                  publicationId: w.publicationId,
                  credentialKind: w.actor.credentialKind,
                  credentialId: w.actor.credentialId,
                  createdAt: w.createdAt,
                }),
            ]
          : []),
      ];
      try {
        await atomic(db, statements);
        return "created";
      } catch (error) {
        if (isConstraintError(error)) return "constraint";
        throw error;
      }
    },

    async writeRevision(w, expectedRevision, onlyCreatorId) {
      const next = expectedRevision + 1;
      const at = w.at.getTime();
      const guard = revisionExists(w.revisionId);
      const statements: Array<() => unknown> = [
        ...nameInserts(w),
        () =>
          db
            .update(publications)
            .set({ ...contentColumns(w), revision: next })
            .where(
              and(
                eq(publications.id, w.publicationId),
                eq(publications.revision, expectedRevision),
                onlyCreatorId ? eq(publications.createdByUserId, onlyCreatorId) : undefined,
              ),
            ),
        // Inserted only if the publication is now at `next`. If another writer got there first, its
        // revision `next` already exists and the unique index rolls this batch back.
        () =>
          db.run(sql`insert into ${publicationRevisions}
            (id, publication_id, revision, snapshot, status, actor_kind, actor_user_id, actor_credential_id, actor_label, created_at)
            select ${w.revisionId}, ${w.publicationId}, ${next}, ${JSON.stringify(toSnapshot(w.content))}, ${w.status},
              ${w.actor.kind}, ${w.actor.userId}, ${w.actor.credentialId}, ${w.actor.label}, ${at}
            where exists (select 1 from ${publications} where ${publications.id} = ${w.publicationId} and ${publications.revision} = ${next})`),
        () => db.run(sql`delete from ${publicationTags} where ${publicationTags.publicationId} = ${w.publicationId} and ${guard}`),
        ...w.tagKeys.map(
          (key) => () =>
            db.run(sql`insert or ignore into ${publicationTags} (publication_id, tag_id)
              select ${w.publicationId}, ${tags.id} from ${tags} where ${tags.normalizedName} = ${key} collate nocase and ${guard}`),
        ),
        ...w.content.attachmentIds.map(
          (attachmentId) => () =>
            db.run(sql`insert or ignore into ${attachmentReferences} (publication_id, revision, attachment_id)
              select ${w.publicationId}, ${next}, ${attachmentId} where ${guard}`),
        ),
      ];
      const updateIndex = w.newCategory ? 1 + w.newTags.length : w.newTags.length;
      try {
        const results = await atomic(db, statements);
        return changesOf(results[updateIndex]) === 1 ? "written" : "stale";
      } catch (error) {
        if (isConstraintError(error)) return "constraint";
        throw error;
      }
    },

    async listRevisions(id) {
      const rows = await db
        .select({
          revision: publicationRevisions.revision,
          status: publicationRevisions.status,
          kind: publicationRevisions.actorKind,
          userId: publicationRevisions.actorUserId,
          name: user.name,
          label: publicationRevisions.actorLabel,
          createdAt: publicationRevisions.createdAt,
        })
        .from(publicationRevisions)
        .innerJoin(user, eq(user.id, publicationRevisions.actorUserId))
        .where(eq(publicationRevisions.publicationId, id))
        .orderBy(desc(publicationRevisions.revision));
      return rows.map((r) => ({
        revision: r.revision,
        status: r.status,
        actor: { kind: r.kind, userId: r.userId, name: r.name, label: r.label },
        createdAt: r.createdAt,
      }));
    },

    async getRevision(id, revision) {
      const rows = await db
        .select({
          revision: publicationRevisions.revision,
          status: publicationRevisions.status,
          kind: publicationRevisions.actorKind,
          userId: publicationRevisions.actorUserId,
          name: user.name,
          label: publicationRevisions.actorLabel,
          createdAt: publicationRevisions.createdAt,
          snapshot: publicationRevisions.snapshot,
        })
        .from(publicationRevisions)
        .innerJoin(user, eq(user.id, publicationRevisions.actorUserId))
        .where(and(eq(publicationRevisions.publicationId, id), eq(publicationRevisions.revision, revision)))
        .limit(1);
      const r = rows[0];
      if (!r) return null;
      return {
        revision: r.revision,
        status: r.status,
        actor: { kind: r.kind, userId: r.userId, name: r.name, label: r.label },
        createdAt: r.createdAt,
        content: fromSnapshot(r.snapshot as unknown as ContentSnapshot),
      };
    },

    async listPublished({ categoryId, type, excludeId, limit, offset, countTotal = true }) {
      const where = and(
        eq(publications.status, "published"),
        categoryId ? eq(publications.categoryId, categoryId) : undefined,
        type ? eq(publications.type, type) : undefined,
        excludeId ? sql`${publications.id} <> ${excludeId}` : undefined,
      );
      const [rows, [count]] = await Promise.all([
        selectListRows(db).where(where).orderBy(desc(publications.publishedAt), desc(publications.id)).limit(limit).offset(offset),
        countTotal ? db.select({ n: sql<number>`count(*)` }).from(publications).where(where) : Promise.resolve([{ n: 0 }]),
      ]);
      return { items: await withTags(db, rows as ListRow[]), total: Number(count?.n ?? 0) };
    },

    async latestPublishedPerCategory(categoryIds, perCategory) {
      const out = new Map<string, ReturnType<typeof toListItem>[]>();
      if (categoryIds.length === 0) return out;
      const ranked = db
        .select({
          id: publications.id,
          rn: sql<number>`row_number() over (partition by ${publications.categoryId} order by ${publications.publishedAt} desc, ${publications.id} desc)`.as("rn"),
        })
        .from(publications)
        .where(and(eq(publications.status, "published"), inArray(publications.categoryId, [...categoryIds])))
        .as("ranked");
      const rows = await selectListRows(db)
        .innerJoin(ranked, eq(ranked.id, publications.id))
        .where(lte(ranked.rn, perCategory))
        .orderBy(desc(publications.publishedAt), desc(publications.id));
      for (const item of await withTags(db, rows as unknown as ListRow[])) {
        const list = out.get(item.category.id) ?? [];
        list.push(item);
        out.set(item.category.id, list);
      }
      return out;
    },

    async listAll({ status, creatorUserId, limit, offset }) {
      const where = and(status ? eq(publications.status, status) : undefined, creatorUserId ? eq(publications.createdByUserId, creatorUserId) : undefined);
      const [rows, [count]] = await Promise.all([
        selectListRows(db).where(where).orderBy(desc(publications.updatedAt), desc(publications.id)).limit(limit).offset(offset),
        db.select({ n: sql<number>`count(*)` }).from(publications).where(where),
      ]);
      return { items: await withTags(db, rows as ListRow[]), total: Number(count?.n ?? 0) };
    },
  };
}
