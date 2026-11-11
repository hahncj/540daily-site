// Publications: the shared validation schema, idempotent create (receipts, replay, conflict), updates with
// an expected revision, immutable revision snapshots, restore as a new revision, visibility, and the
// agent ownership rule. Editor forms, MCP, and the HTTP API all call this one service.
import { z } from "zod";
import { canCreatePublication, canEdit, canUpdatePublication, type Actor, type CredentialKind } from "./actors";
import type { Attachments } from "./attachments";
import type { Audit } from "./audit";
import type { Category, Tag } from "./categories";
import { canonicalJson, sha256Hex } from "./hash";
import { ATTACHMENT_ID_PATTERN, type MarkdownRenderer } from "./markdown";
import { displayName, normalizedName, slugify, uniqueNames, uniqueSlug } from "./names";
import type { PublishingFailures } from "./publishing-failures";
import { fail, fieldErrors, ok, type Failure, type Result } from "./result";

// ---------------------------------------------------------------------------
// Schema (REQUIREMENTS.md section 6)
// ---------------------------------------------------------------------------

export const PUBLICATION_TYPES = ["story", "report"] as const;
export type PublicationType = (typeof PUBLICATION_TYPES)[number];
export const PUBLICATION_STATUSES = ["draft", "published", "unpublished"] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

export const LIMITS = {
  externalId: 128,
  title: 200,
  summary: 1000,
  body: 100_000,
  category: 80,
  tags: 20,
  tag: 60,
  sources: 20,
  sourceUrl: 2000,
  sourceLabel: 200,
  attachments: 20,
} as const;

const notBlank = (max: number) => z.string().trim().min(1, "Required.").max(max, `At most ${max} characters.`);

const externalIdSchema = z
  .string()
  .min(1, "Required.")
  .max(LIMITS.externalId, `At most ${LIMITS.externalId} characters.`)
  .regex(/\S/, "Must not be blank.")
  .describe("Your unique ID for this publication. Resending the same create with it is safe.");

const sourceSchema = z.object({
  url: z
    .url({ protocol: /^https?$/, message: "Use an http or https link." })
    .max(LIMITS.sourceUrl)
    .describe("Link to the source. 540 Daily never fetches it."),
  label: z.string().trim().max(LIMITS.sourceLabel).optional(),
});

/** Field shapes shared by create and update. MCP tools use these raw shapes; core runs the refined schemas. */
export const publicationFieldsShape = {
  type: z.enum(PUBLICATION_TYPES).describe("story or report. A daily briefing is a report tagged 'briefing'."),
  title: notBlank(LIMITS.title),
  summary: notBlank(LIMITS.summary).describe("Plain text."),
  bodyMarkdown: z
    .string()
    .max(LIMITS.body, `At most ${LIMITS.body} characters.`)
    .nullable()
    .optional()
    .describe("Markdown. Required for reports. Images: ![alt text](attachment:ID)."),
  category: notBlank(LIMITS.category).describe("Category display name. New categories are created automatically."),
  tags: z
    .array(notBlank(LIMITS.tag))
    .max(LIMITS.tags, `At most ${LIMITS.tags} tags.`)
    .optional()
    .describe("Optional topics, teams, people, or companies."),
  sources: z.array(sourceSchema).max(LIMITS.sources, `At most ${LIMITS.sources} sources.`).optional(),
  attachmentIds: z
    .array(z.string().regex(ATTACHMENT_ID_PATTERN, "Not an attachment ID."))
    .max(LIMITS.attachments, `At most ${LIMITS.attachments} attachments.`)
    .optional()
    .describe("IDs from prepare_attachment_upload, uploaded by you."),
  sourcePublishedAt: z
    .union([z.iso.datetime({ offset: true }), z.iso.date()])
    .nullable()
    .optional()
    .describe("When the source was published (ISO 8601). Separate from the 540 Daily publication time."),
};

/** Agent create: externalId is required. */
export const agentCreateShape = { externalId: externalIdSchema, ...publicationFieldsShape };
/** Editor create on the website: externalId is optional. */
export const memberCreateShape = { externalId: externalIdSchema.optional(), ...publicationFieldsShape };
/** Update: every field optional, plus the revision the caller last saw. */
export const publicationUpdateShape = {
  expectedRevision: z.number().int().positive().describe("The revision you last read. A stale value returns a conflict."),
  ...Object.fromEntries(Object.entries(publicationFieldsShape).map(([k, v]) => [k, v.optional()])),
} as { expectedRevision: z.ZodNumber } & { [K in keyof typeof publicationFieldsShape]: z.ZodOptional<(typeof publicationFieldsShape)[K]> };

const reportNeedsBody = (p: { type?: string; bodyMarkdown?: string | null }) => p.type !== "report" || !!p.bodyMarkdown?.trim();
const reportBodyIssue = { path: ["bodyMarkdown"], message: "Reports need a body." };

export const agentCreateSchema = z.strictObject(agentCreateShape).refine(reportNeedsBody, reportBodyIssue);
export const memberCreateSchema = z.strictObject(memberCreateShape).refine(reportNeedsBody, reportBodyIssue);
export const publicationUpdateSchema = z.strictObject(publicationUpdateShape);
const fullFieldsSchema = z.strictObject(publicationFieldsShape).refine(reportNeedsBody, reportBodyIssue);

/** Normalized content: what a revision snapshot stores and what create/update write. */
export type PublicationContent = {
  type: PublicationType;
  title: string;
  summary: string;
  bodyMarkdown: string | null;
  /** Display name, normalized (NFKC, trimmed, single spaces). */
  category: string;
  tags: string[];
  sources: Array<{ url: string; label?: string }>;
  attachmentIds: string[];
  sourcePublishedAt: Date | null;
};

type ParsedFields = z.output<typeof fullFieldsSchema>;

function normalizeContent(p: ParsedFields, attachmentRefs: MarkdownRenderer["attachmentRefs"]): Result<PublicationContent> {
  const body = p.bodyMarkdown?.trim() ? p.bodyMarkdown : null;
  const category = displayName(p.category);
  if (!category || category.length > LIMITS.category) {
    return fail("invalid", "Invalid publication.", { errors: { category: [`1–${LIMITS.category} characters.`] } });
  }
  const tags = uniqueNames(p.tags ?? []);
  if (tags.some((t) => t.length > LIMITS.tag)) {
    return fail("invalid", "Invalid publication.", { errors: { tags: [`Each tag at most ${LIMITS.tag} characters after normalization.`] } });
  }
  // Every `attachment:ID` in the Markdown must be an authorized attachment; include them automatically.
  const attachmentIds = [...new Set([...(p.attachmentIds ?? []), ...attachmentRefs(body)])];
  if (attachmentIds.length > LIMITS.attachments) {
    return fail("invalid", "Invalid publication.", { errors: { attachmentIds: [`At most ${LIMITS.attachments} attachments.`] } });
  }
  return ok({
    type: p.type,
    title: p.title,
    summary: p.summary,
    bodyMarkdown: body,
    category,
    tags,
    sources: (p.sources ?? []).map((s) => (s.label ? { url: s.url, label: s.label } : { url: s.url })),
    attachmentIds,
    sourcePublishedAt: p.sourcePublishedAt ? new Date(p.sourcePublishedAt) : null,
  });
}

export type ContentSnapshot = Omit<PublicationContent, "sourcePublishedAt"> & { sourcePublishedAt: string | null };

/** JSON form stored in `publication_revisions.snapshot`. */
export function toSnapshot(c: PublicationContent): ContentSnapshot {
  return { ...c, sourcePublishedAt: c.sourcePublishedAt?.toISOString() ?? null };
}

export function fromSnapshot(s: ContentSnapshot): PublicationContent {
  return {
    type: s.type,
    title: s.title,
    summary: s.summary,
    bodyMarkdown: s.bodyMarkdown ?? null,
    category: s.category,
    tags: s.tags ?? [],
    sources: s.sources ?? [],
    attachmentIds: s.attachmentIds ?? [],
    sourcePublishedAt: s.sourcePublishedAt ? new Date(s.sourcePublishedAt) : null,
  };
}


/** Canonical create-payload hash for retry protection: same member + externalId + payload → replay. */
export async function createPayloadHash(externalId: string, content: PublicationContent): Promise<string> {
  return sha256Hex(canonicalJson({ externalId, ...toSnapshot(content) }));
}

/** Equal content; category and tags compare by normalized name (they resolve to the same rows); sets ignore order. */
function sameContent(a: PublicationContent, b: PublicationContent) {
  const key = (c: PublicationContent) =>
    canonicalJson({ ...toSnapshot(c), category: normalizedName(c.category), tags: c.tags.map(normalizedName).sort(), attachmentIds: [...c.attachmentIds].sort() });
  return key(a) === key(b);
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export type Creator = { userId: string; name: string; kind: "member" | "agent"; label: string | null };

export type Publication = {
  id: string;
  type: PublicationType;
  title: string;
  summary: string;
  bodyMarkdown: string | null;
  category: Category;
  tags: Tag[];
  sources: Array<{ url: string; label?: string }>;
  attachmentIds: string[];
  sourcePublishedAt: Date | null;
  status: PublicationStatus;
  revision: number;
  createdBy: Creator;
  createdAt: Date;
  /** Original app publication time. Recency uses it; edits do not change it. Null for drafts never published. */
  publishedAt: Date | null;
  updatedAt: Date;
};

export type PublicationListItem = Omit<Publication, "bodyMarkdown" | "sources" | "attachmentIds" | "sourcePublishedAt">;

export type RevisionSummary = {
  revision: number;
  status: PublicationStatus;
  actor: { kind: "member" | "agent"; userId: string; name: string; label: string | null };
  createdAt: Date;
};
export type Revision = RevisionSummary & { content: PublicationContent };

export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
export const PAGE_SIZE = 20;
export const PANEL_SIZE = 5;
const HOUR_MS = 60 * 60 * 1000;
export const RELATED_SIZE = 5;

/** Canonical page path for a publication: `/publications/:id/:slug`. */
export function publicationPath(p: Pick<Publication, "id" | "title">): string {
  return `/publications/${encodeURIComponent(p.id)}/${slugify(p.title, "publication")}`;
}

/** "<member> via <client>" for agent-created items; the member's name otherwise. */
export function attribution(creator: Creator): string {
  return creator.kind === "agent" && creator.label ? `${creator.name} via ${creator.label}` : creator.name;
}

// ---------------------------------------------------------------------------
// Repository port
// ---------------------------------------------------------------------------

/** A category or tag row to insert if its normalized name is new. */
export type NameRow = { id: string; name: string; normalizedName: string; slug: string; createdAt: Date };

export type ActorRecord = {
  kind: "member" | "agent";
  userId: string;
  credentialKind: CredentialKind | null;
  credentialId: string | null;
  label: string | null;
};

export type RevisionWrite = {
  publicationId: string;
  revisionId: string;
  content: PublicationContent;
  /** Normalized key of `content.category`, and of each tag. */
  categoryKey: string;
  tagKeys: string[];
  newCategory: NameRow | null;
  newTags: NameRow[];
  status: PublicationStatus;
  publishedAt: Date | null;
  actor: ActorRecord;
  at: Date;
};

export interface PublicationsRepository {
  get(id: string): Promise<Publication | null>;
  findReceipt(userId: string, externalId: string): Promise<{ publicationId: string; payloadHash: string } | null>;
  /** Existing rows by normalized name. */
  findNames(kind: "category" | "tag", keys: readonly string[]): Promise<Map<string, { id: string; slug: string }>>;
  /** Slugs in use equal to one of `bases` or starting with `<base>-`. */
  slugsInUse(kind: "category" | "tag", bases: readonly string[]): Promise<Set<string>>;
  /**
   * One transaction: names, publication, revision 1, tag links, attachment references, and the receipt.
   * "constraint" means a unique or not-null check failed (a concurrent duplicate or a slug race) and
   * nothing was written.
   */
  create(
    write: RevisionWrite & { createdAt: Date },
    receipt: { id: string; userId: string; externalId: string; payloadHash: string } | null,
  ): Promise<"created" | "constraint">;
  /**
   * One transaction, only if the publication is still at `expectedRevision` (and, when given, created by
   * `onlyCreatorId`): update the row to `expectedRevision + 1` and append that revision.
   */
  writeRevision(write: RevisionWrite, expectedRevision: number, onlyCreatorId: string | null): Promise<"written" | "stale" | "constraint">;
  listRevisions(id: string): Promise<RevisionSummary[]>;
  getRevision(id: string, revision: number): Promise<Revision | null>;
  /** `total` is 0 when `countTotal` is false (skips the count query). */
  listPublished(filter: { categoryId?: string; type?: PublicationType; excludeId?: string; limit: number; offset: number; countTotal?: boolean }): Promise<{ items: PublicationListItem[]; total: number }>;
  /** With `tagIds`, only items carrying at least one of those tags. */
  latestPublishedPerCategory(categoryIds: readonly string[], perCategory: number, tagIds?: readonly string[]): Promise<Map<string, PublicationListItem[]>>;
  /**
   * Like `latestPublishedPerCategory`, over every category, counting only items published at or after
   * `since`. Categories with no such item are absent. Map order: by each category's newest item, newest first.
   */
  recentPublishedPerCategory(filter: { since: Date; perCategory: number; tagIds?: readonly string[] }): Promise<Map<string, PublicationListItem[]>>;
  listAll(filter: { status?: PublicationStatus; creatorUserId?: string; limit: number; offset: number }): Promise<{ items: PublicationListItem[]; total: number }>;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export type CreateOutcome = { publication: Publication; replayed: boolean };

type Deps = {
  repo: PublicationsRepository;
  attachments: Attachments;
  markdown: MarkdownRenderer;
  audit: Audit;
  failures: PublishingFailures;
  now: () => Date;
  newId: () => string;
};

export type Publications = ReturnType<typeof createPublications>;

const MAX_WRITE_ATTEMPTS = 3;

export function createPublications({ repo, attachments, markdown, audit, failures, now, newId }: Deps) {
  const actorRecord = (actor: Actor): ActorRecord =>
    actor.kind === "agent"
      ? { kind: "agent", userId: actor.userId, credentialKind: actor.credentialKind, credentialId: actor.credentialId, label: actor.label }
      : { kind: "member", userId: actor.userId, credentialKind: null, credentialId: null, label: null };

  /** Resolve the category and tags: existing rows by normalized name, new rows with collision-safe slugs. */
  async function planNames(content: PublicationContent, at: Date) {
    const categoryKey = normalizedName(content.category);
    const tagKeys = content.tags.map(normalizedName);
    const [cats, tags] = await Promise.all([repo.findNames("category", [categoryKey]), repo.findNames("tag", tagKeys)]);

    let newCategory: NameRow | null = null;
    if (!cats.has(categoryKey)) {
      const base = slugify(content.category, "category");
      const taken = await repo.slugsInUse("category", [base]);
      newCategory = { id: newId(), name: content.category, normalizedName: categoryKey, slug: uniqueSlug(base, taken), createdAt: at };
    }
    const missing = content.tags.filter((_, i) => !tags.has(tagKeys[i]!));
    const newTags: NameRow[] = [];
    if (missing.length) {
      const bases = missing.map((t) => slugify(t, "tag"));
      const taken = await repo.slugsInUse("tag", bases);
      missing.forEach((name, i) => {
        const slug = uniqueSlug(bases[i]!, taken);
        taken.add(slug);
        newTags.push({ id: newId(), name, normalizedName: normalizedName(name), slug, createdAt: at });
      });
    }
    return { categoryKey, tagKeys, newCategory, newTags };
  }

  function parseFailure(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>): Failure {
    return fail("invalid", "Invalid publication.", { errors: fieldErrors(issues) });
  }

  async function logFailure(actor: Actor, operation: string, failure: Failure, externalId: string | null) {
    if (actor.kind !== "agent") return; // the owner's view lists agent publishing failures
    await failures.record({
      userId: actor.userId,
      credentialKind: actor.credentialKind,
      credentialId: actor.credentialId,
      operation,
      status: failure.status,
      message: failure.errors ? `${failure.message} ${JSON.stringify(failure.errors)}` : failure.message,
      externalId,
    });
  }

  /** Run an operation and record agent failures (including thrown errors) in the bounded failure log. */
  async function tracked<T>(actor: Actor, operation: string, externalId: string | null, run: () => Promise<Result<T>>): Promise<Result<T>> {
    try {
      const out = await run();
      if (!out.ok) await logFailure(actor, operation, out, externalId);
      return out;
    } catch (error) {
      await logFailure(actor, operation, fail("unavailable", "Unexpected error."), externalId);
      throw error;
    }
  }

  async function replayOrConflict(receipt: { publicationId: string; payloadHash: string }, payloadHash: string): Promise<Result<CreateOutcome>> {
    if (receipt.payloadHash !== payloadHash) {
      return fail("conflict", "This externalId was already used with a different payload. Use update to change a publication.");
    }
    const publication = await repo.get(receipt.publicationId);
    if (!publication) return fail("unavailable", "The original publication could not be read. Retry.");
    return ok({ publication, replayed: true });
  }

  /** Visible to this actor: published, or (agents) the member's own, or (editors) anything. */
  function visibleTo(actor: Actor | null, p: Publication): boolean {
    if (p.status === "published") return true;
    if (!actor) return false;
    if (canEdit(actor)) return true;
    return actor.kind === "agent" && actor.userId === p.createdBy.userId;
  }

  function contentOf(p: Publication): PublicationContent {
    return {
      type: p.type,
      title: p.title,
      summary: p.summary,
      bodyMarkdown: p.bodyMarkdown,
      category: p.category.name,
      tags: p.tags.map((t) => t.name),
      sources: p.sources,
      attachmentIds: p.attachmentIds,
      sourcePublishedAt: p.sourcePublishedAt,
    };
  }

  /**
   * Append a revision with new content and/or status, guarded by the expected revision.
   * Retries only for slug races; a stale revision returns a conflict with the current revision.
   */
  async function appendRevision(
    actor: Actor,
    current: Publication,
    expectedRevision: number,
    content: PublicationContent,
    status: PublicationStatus,
    publishedAt: Date | null,
  ): Promise<Result<Publication>> {
    const onlyCreator = actor.kind === "agent" ? actor.userId : null;
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
      const at = now();
      const names = await planNames(content, at);
      const outcome = await repo.writeRevision(
        { publicationId: current.id, revisionId: newId(), content, status, publishedAt, actor: actorRecord(actor), at, ...names },
        expectedRevision,
        onlyCreator,
      );
      if (outcome === "written") {
        const saved = await repo.get(current.id);
        if (!saved) return fail("unavailable", "The publication could not be read back. Retry.");
        return ok(saved);
      }
      const fresh = await repo.get(current.id);
      if (!fresh || fresh.revision !== expectedRevision) {
        return fail("conflict", "This publication changed since you loaded it. Reload and reapply your changes.", {
          currentRevision: fresh?.revision,
        });
      }
      if (outcome === "stale") break;
    }
    return fail("unavailable", "The publication could not be saved. Retry.");
  }

  function staleRevision(expected: number, current: Publication): Failure | null {
    return expected === current.revision
      ? null
      : fail("conflict", "This publication changed since you loaded it. Reload and reapply your changes.", { currentRevision: current.revision });
  }

  /** Shared guard for editor-only actions. Hides nothing: editors can see every publication. */
  async function loadForEditor(actor: Actor, id: string): Promise<Result<Publication>> {
    if (!canEdit(actor)) return fail("forbidden", "Only editors can do that.");
    const p = await repo.get(id);
    return p ? ok(p) : fail("not_found", "Publication not found.");
  }

  async function changeStatus(
    actor: Actor,
    id: string,
    expectedRevision: number,
    target: "published" | "unpublished",
    allowedFrom: readonly PublicationStatus[],
    action: string,
  ): Promise<Result<Publication>> {
    const loaded = await loadForEditor(actor, id);
    if (!loaded.ok) return loaded;
    const current = loaded.value;
    const stale = staleRevision(expectedRevision, current);
    if (stale) return stale;
    if (!allowedFrom.includes(current.status)) return fail("invalid", `This publication is ${current.status}, so it cannot be ${STATUS_VERB[action]}.`);
    // Restoring visibility keeps the original publication time, so it does not jump to the top.
    const publishedAt = current.publishedAt ?? (target === "published" ? now() : null);
    const out = await appendRevision(actor, current, expectedRevision, contentOf(current), target, publishedAt);
    if (out.ok) await audit.record(actor, `publication.${action}`, { type: "publication", id }, { revision: out.value.revision });
    return out;
  }

  return {
    /**
     * Create a publication. Agents publish immediately and must send an externalId; a retry with the same
     * member, externalId, and payload replays the original (even across MCP and HTTP); a different payload
     * returns a conflict. Editors on the website create drafts unless `publish` is set.
     */
    create(actor: Actor, input: unknown, options: { publish?: boolean } = {}): Promise<Result<CreateOutcome>> {
      const externalId = typeof (input as { externalId?: unknown })?.externalId === "string" ? ((input as { externalId: string }).externalId) : null;
      return tracked(actor, "create_publication", externalId, async () => {
        if (!canCreatePublication(actor)) return fail("forbidden", "Only editors and the owner can create publications.");
        const parsed = (actor.kind === "agent" ? agentCreateSchema : memberCreateSchema).safeParse(input);
        if (!parsed.success) return parseFailure(parsed.error.issues);
        const { externalId: extId, ...fields } = parsed.data;
        const normalized = normalizeContent(fields, markdown.attachmentRefs);
        if (!normalized.ok) return normalized;
        const content = normalized.value;

        const payloadHash = extId ? await createPayloadHash(extId, content) : null;
        if (extId && payloadHash) {
          const receipt = await repo.findReceipt(actor.userId, extId);
          if (receipt) return replayOrConflict(receipt, payloadHash);
        }
        const authorized = await attachments.authorize(actor, content.attachmentIds, null);
        if (!authorized.ok) return authorized;

        const status: PublicationStatus = actor.kind === "agent" || options.publish ? "published" : "draft";
        for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
          const at = now();
          const id = newId();
          const names = await planNames(content, at);
          const outcome = await repo.create(
            {
              publicationId: id,
              revisionId: newId(),
              content,
              status,
              publishedAt: status === "published" ? at : null,
              actor: actorRecord(actor),
              at,
              createdAt: at,
              ...names,
            },
            extId && payloadHash ? { id: newId(), userId: actor.userId, externalId: extId, payloadHash } : null,
          );
          if (outcome === "created") {
            const publication = await repo.get(id);
            if (!publication) return fail("unavailable", "The publication could not be read back. Retry.");
            await audit.record(actor, "publication.create", { type: "publication", id }, { status, externalId: extId ?? null });
            return ok({ publication, replayed: false });
          }
          // A concurrent identical create may have won the receipt's unique index: replay it.
          if (extId && payloadHash) {
            const receipt = await repo.findReceipt(actor.userId, extId);
            if (receipt) return replayOrConflict(receipt, payloadHash);
          }
        }
        return fail("unavailable", "The publication could not be saved. Retry.");
      });
    },

    /**
     * Update content. Requires `expectedRevision`; a stale one returns a conflict and nothing is lost.
     * Agents may update only the member's own publications and never change visibility, so an agent
     * cannot republish an item an editor unpublished.
     */
    update(actor: Actor, id: string, input: unknown): Promise<Result<Publication>> {
      return tracked(actor, "update_publication", null, async () => {
        const current = await repo.get(id);
        // Another member's private item looks the same as a missing one.
        if (!current || !visibleTo(actor, current)) return fail("not_found", "Publication not found.");
        if (!canUpdatePublication(actor, current.createdBy.userId)) {
          return fail("forbidden", actor.kind === "agent" ? "Agents can update only their member's own publications." : "Only editors can update publications.");
        }
        const parsed = publicationUpdateSchema.safeParse(input);
        if (!parsed.success) return parseFailure(parsed.error.issues);
        const { expectedRevision, ...patch } = parsed.data;
        const base = toSnapshot(contentOf(current));
        // Markdown references are recomputed from the new body; only explicitly listed extras carry over.
        const inBody = new Set(markdown.attachmentRefs(current.bodyMarkdown));
        base.attachmentIds = base.attachmentIds.filter((a) => !inBody.has(a));
        const merged = { ...base, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
        const full = fullFieldsSchema.safeParse(merged);
        if (!full.success) return parseFailure(full.error.issues);
        const normalized = normalizeContent(full.data, markdown.attachmentRefs);
        if (!normalized.ok) return normalized;
        const stale = staleRevision(expectedRevision, current);
        if (stale) return stale;
        if (sameContent(normalized.value, contentOf(current))) return ok(current);

        const authorized = await attachments.authorize(actor, normalized.value.attachmentIds, current.id);
        if (!authorized.ok) return authorized;
        const out = await appendRevision(actor, current, expectedRevision, normalized.value, current.status, current.publishedAt);
        if (out.ok) await audit.record(actor, "publication.update", { type: "publication", id }, { revision: out.value.revision });
        return out;
      });
    },

    /** Editors: publish a draft. */
    publish: (actor: Actor, id: string, expectedRevision: number) => changeStatus(actor, id, expectedRevision, "published", ["draft"], "publish"),
    /** Editors: hide a published item from every public surface. */
    unpublish: (actor: Actor, id: string, expectedRevision: number) => changeStatus(actor, id, expectedRevision, "unpublished", ["published"], "unpublish"),
    /** Editors: return an unpublished item to public view, keeping its original publication time. */
    restoreVisibility: (actor: Actor, id: string, expectedRevision: number) =>
      changeStatus(actor, id, expectedRevision, "published", ["unpublished"], "restore_visibility"),

    /** Editors: restore an older revision's content as a new revision. Visibility is unchanged. */
    async restoreRevision(actor: Actor, id: string, revision: number, expectedRevision: number): Promise<Result<Publication>> {
      const loaded = await loadForEditor(actor, id);
      if (!loaded.ok) return loaded;
      const current = loaded.value;
      const old = await repo.getRevision(id, revision);
      if (!old) return fail("not_found", "Revision not found.");
      const stale = staleRevision(expectedRevision, current);
      if (stale) return stale;
      const authorized = await attachments.authorize(actor, old.content.attachmentIds, id);
      if (!authorized.ok) return authorized;
      const out = await appendRevision(actor, current, expectedRevision, old.content, current.status, current.publishedAt);
      if (out.ok) await audit.record(actor, "publication.restore_revision", { type: "publication", id }, { from: revision, revision: out.value.revision });
      return out;
    },

    /** Editors: revision history, newest first. */
    async history(actor: Actor, id: string): Promise<Result<RevisionSummary[]>> {
      const loaded = await loadForEditor(actor, id);
      if (!loaded.ok) return loaded;
      return ok(await repo.listRevisions(id));
    },

    async getRevision(actor: Actor, id: string, revision: number): Promise<Result<Revision>> {
      if (!canEdit(actor)) return fail("forbidden", "Only editors can do that.");
      const r = await repo.getRevision(id, revision);
      return r ? ok(r) : fail("not_found", "Revision not found.");
    },

    /** Public detail: published only. Drafts and unpublished items are indistinguishable from missing. */
    async getPublic(id: string): Promise<Publication | null> {
      const p = await repo.get(id);
      return p && p.status === "published" ? p : null;
    },

    /** Agent read: published items, plus the member's own items in any status. Never another member's private item. */
    async getForAgent(actor: Actor, id: string): Promise<Publication | null> {
      const p = await repo.get(id);
      if (!p) return null;
      if (p.status === "published" || p.createdBy.userId === actor.userId) return p;
      return null;
    },

    /** Editor read: any status. */
    async getForEditor(actor: Actor, id: string): Promise<Publication | null> {
      return canEdit(actor) ? repo.get(id) : null;
    },

    /** Editor list, newest activity first, optionally by status. */
    async listForEditor(actor: Actor, filter: { status?: PublicationStatus; page?: number } = {}): Promise<Result<Page<PublicationListItem>>> {
      if (!canEdit(actor)) return fail("forbidden", "Only editors can do that.");
      const page = clampPage(filter.page);
      const { items, total } = await repo.listAll({ status: filter.status, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
      return ok({ items, total, page, pageSize: PAGE_SIZE });
    },

    /** Category page: published items, newest first, with an optional type filter. */
    async listPublished(filter: { categoryId?: string; type?: PublicationType; page?: number } = {}): Promise<Page<PublicationListItem>> {
      const page = clampPage(filter.page);
      const { items, total } = await repo.listPublished({ categoryId: filter.categoryId, type: filter.type, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
      return { items, total, page, pageSize: PAGE_SIZE };
    },

    /**
     * Dashboard panels: the newest published items per category. With `tagIds` (a reader's interests),
     * only items with any of those tags.
     */
    latestPerCategory: (categoryIds: readonly string[], perCategory = PANEL_SIZE, tagIds?: readonly string[]) =>
      repo.latestPublishedPerCategory(categoryIds, perCategory, tagIds),

    /**
     * Home page panels: for every category with items published in the last `windowHours`, its newest
     * items from that window (any of `tagIds`, when given). Ordered by each category's newest item.
     */
    recentPerCategory: (windowHours: number, tagIds?: readonly string[], perCategory = PANEL_SIZE) =>
      repo.recentPublishedPerCategory({ since: new Date(now().getTime() - windowHours * HOUR_MS), perCategory, tagIds }),

    /** The newest published items site-wide, for a home page with nothing recent. */
    async newestPublished(limit = PANEL_SIZE): Promise<PublicationListItem[]> {
      return (await repo.listPublished({ limit, offset: 0, countTotal: false })).items;
    },

    /** Up to five published items from the same category, excluding this one, newest first. */
    async related(p: Pick<Publication, "id" | "category">): Promise<PublicationListItem[]> {
      const { items } = await repo.listPublished({ categoryId: p.category.id, excludeId: p.id, limit: RELATED_SIZE, offset: 0, countTotal: false });
      return items;
    },

    /** Safe HTML for a publication version's body, with only its own attachments shown inline. */
    async renderBody(p: Pick<Publication, "bodyMarkdown" | "attachmentIds">): Promise<string> {
      if (!p.bodyMarkdown) return "";
      return markdown.render(p.bodyMarkdown, { attachments: await attachments.renderable(p.attachmentIds) });
    },

    /** Editor preview: the same renderer as the public page. */
    async preview(actor: Actor, bodyMarkdown: string, attachmentIds: readonly string[] = []): Promise<Result<string>> {
      if (!canEdit(actor)) return fail("forbidden", "Only editors can do that.");
      if (bodyMarkdown.length > LIMITS.body) return fail("too_large", `At most ${LIMITS.body} characters.`);
      const ids = [...new Set([...attachmentIds, ...markdown.attachmentRefs(bodyMarkdown)])].slice(0, LIMITS.attachments);
      return ok(markdown.render(bodyMarkdown, { attachments: await attachments.renderable(ids) }));
    },
  };
}

const STATUS_VERB: Record<string, string> = { publish: "published", unpublish: "unpublished", restore_visibility: "restored to public view" };

function clampPage(page: number | undefined) {
  return Number.isInteger(page) && page! >= 1 ? Math.min(page!, 10_000) : 1;
}
