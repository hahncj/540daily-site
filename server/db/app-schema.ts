// 540 News tables. Logical entities: REQUIREMENTS.md section 7. Conventions: DATA_AND_STORAGE.md section 3.
// Migrations only add tables, columns, and indexes. After a change: `npm run db:generate`, review, commit with meta/.
import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });

export const ROLE_VALUES = ["reader", "editor", "owner"] as const;
export const PUBLICATION_TYPES = ["story", "report"] as const;
export const PUBLICATION_STATUSES = ["draft", "published", "unpublished"] as const;
export const ACTOR_KINDS = ["member", "agent"] as const;
export const CREDENTIAL_KINDS = ["oauth", "api_key"] as const;
export const ATTACHMENT_STATUSES = ["pending", "ready", "rejected"] as const;
export const THEMES = ["system", "light", "dark"] as const;

export type PublicationSource = { url: string; label?: string };

// ---------------------------------------------------------------------------
// Membership and access
// ---------------------------------------------------------------------------

/** One row per member. Role and status are re-read on every protected request and agent call. */
export const memberships = sqliteTable("memberships", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  role: text("role", { enum: ROLE_VALUES }).notNull(),
  status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  disabledAt: timestamp("disabled_at"),
});

/** Owner-issued invitations for an exact, case-normalized email. */
export const invitations = sqliteTable(
  "invitations",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    role: text("role", { enum: ROLE_VALUES }).notNull().default("reader"),
    invitedByUserId: text("invited_by_user_id").references(() => user.id),
    createdAt: timestamp("created_at").notNull(),
    acceptedAt: timestamp("accepted_at"),
    acceptedUserId: text("accepted_user_id").references(() => user.id),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => [
    // At most one open invitation per email.
    uniqueIndex("invitations_open_email_unique")
      .on(sql`${t.email} collate nocase`)
      .where(sql`${t.acceptedAt} is null and ${t.revokedAt} is null`),
    index("invitations_email_idx").on(t.email),
  ],
);

/** Member-owned API keys. Only the SHA-256 hash is stored; the secret is shown once at creation. */
export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    keyHash: text("key_hash").notNull(),
    displayPrefix: text("display_prefix").notNull(),
    createdAt: timestamp("created_at").notNull(),
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => [uniqueIndex("api_keys_key_hash_unique").on(t.keyHash), index("api_keys_user_idx").on(t.userId)],
);

/** MCP connection revocations. Access tokens issued at or before revoked_at are refused. */
export const toolRevocations = sqliteTable(
  "tool_revocations",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    revokedAt: timestamp("revoked_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.clientId] })],
);

// ---------------------------------------------------------------------------
// Categories, tags, and the public homepage layout
// ---------------------------------------------------------------------------

export const categories = sqliteTable(
  "categories",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    slug: text("slug").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("categories_normalized_name_unique").on(sql`${t.normalizedName} collate nocase`),
    uniqueIndex("categories_slug_unique").on(t.slug),
  ],
);

export const tags = sqliteTable(
  "tags",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    slug: text("slug").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("tags_normalized_name_unique").on(sql`${t.normalizedName} collate nocase`),
    uniqueIndex("tags_slug_unique").on(t.slug),
  ],
);

/** Editor-managed public homepage: which categories appear, in what order. */
export const homepagePanels = sqliteTable(
  "homepage_panels",
  {
    categoryId: text("category_id")
      .primaryKey()
      .references(() => categories.id),
    position: integer("position").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    updatedByUserId: text("updated_by_user_id").references(() => user.id),
  },
  (t) => [index("homepage_panels_position_idx").on(t.position)],
);

// ---------------------------------------------------------------------------
// Publications and history
// ---------------------------------------------------------------------------

export const publications = sqliteTable(
  "publications",
  {
    id: text("id").primaryKey(),
    type: text("type", { enum: PUBLICATION_TYPES }).notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    bodyMarkdown: text("body_markdown"),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id),
    sources: text("sources", { mode: "json" }).$type<PublicationSource[]>().notNull().default(sql`'[]'`),
    sourcePublishedAt: timestamp("source_published_at"),
    status: text("status", { enum: PUBLICATION_STATUSES }).notNull(),
    revision: integer("revision").notNull().default(1),
    // Creator identity. Editor changes never change these.
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id),
    createdByKind: text("created_by_kind", { enum: ACTOR_KINDS }).notNull(),
    createdByCredentialKind: text("created_by_credential_kind", { enum: CREDENTIAL_KINDS }),
    createdByCredentialId: text("created_by_credential_id"),
    /** Client name or key label, for "<member> via <client>" attribution. */
    createdByLabel: text("created_by_label"),
    createdAt: timestamp("created_at").notNull(),
    /** Original app publication time; recency uses this, so edits do not move items to the top. */
    publishedAt: timestamp("published_at"),
    updatedAt: timestamp("updated_at").notNull(),
    updatedByUserId: text("updated_by_user_id").references(() => user.id),
  },
  (t) => [
    index("publications_status_published_idx").on(t.status, t.publishedAt, t.id),
    index("publications_category_status_published_idx").on(t.categoryId, t.status, t.publishedAt, t.id),
    index("publications_creator_idx").on(t.createdByUserId),
  ],
);

export const publicationTags = sqliteTable(
  "publication_tags",
  {
    publicationId: text("publication_id")
      .notNull()
      .references(() => publications.id),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id),
  },
  (t) => [primaryKey({ columns: [t.publicationId, t.tagId] }), index("publication_tags_tag_idx").on(t.tagId)],
);

/** Append-only snapshots. Every content or status change adds one; restore adds a new one. */
export const publicationRevisions = sqliteTable(
  "publication_revisions",
  {
    id: text("id").primaryKey(),
    publicationId: text("publication_id")
      .notNull()
      .references(() => publications.id),
    revision: integer("revision").notNull(),
    snapshot: text("snapshot", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    status: text("status", { enum: PUBLICATION_STATUSES }).notNull(),
    actorKind: text("actor_kind", { enum: ACTOR_KINDS }).notNull(),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => user.id),
    actorCredentialId: text("actor_credential_id"),
    actorLabel: text("actor_label"),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [uniqueIndex("publication_revisions_publication_revision_unique").on(t.publicationId, t.revision)],
);

/** Retry protection: one receipt per member and external ID, across all of the member's keys and connections. */
export const submissionReceipts = sqliteTable(
  "submission_receipts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    externalId: text("external_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    publicationId: text("publication_id")
      .notNull()
      .references(() => publications.id),
    credentialKind: text("credential_kind", { enum: CREDENTIAL_KINDS }),
    credentialId: text("credential_id"),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [uniqueIndex("submission_receipts_user_external_unique").on(t.userId, t.externalId)],
);

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export const attachments = sqliteTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    uploaderUserId: text("uploader_user_id")
      .notNull()
      .references(() => user.id),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    /** Declared size at ticket time; actual size once uploaded. */
    size: integer("size").notNull(),
    sha256: text("sha256"),
    altText: text("alt_text").notNull(),
    status: text("status", { enum: ATTACHMENT_STATUSES }).notNull().default("pending"),
    createdAt: timestamp("created_at").notNull(),
    readyAt: timestamp("ready_at"),
  },
  (t) => [uniqueIndex("attachments_storage_key_unique").on(t.storageKey), index("attachments_uploader_idx").on(t.uploaderUserId, t.createdAt)],
);

/** Short-lived, single-use upload tickets bound to the member, MIME type, and size limit. */
export const uploadTickets = sqliteTable(
  "upload_tickets",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    attachmentId: text("attachment_id")
      .notNull()
      .references(() => attachments.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    mimeType: text("mime_type").notNull(),
    maxSize: integer("max_size").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [uniqueIndex("upload_tickets_token_hash_unique").on(t.tokenHash)],
);

/** Which attachments each publication revision uses, so historical revisions keep their assets. */
export const attachmentReferences = sqliteTable(
  "attachment_references",
  {
    publicationId: text("publication_id")
      .notNull()
      .references(() => publications.id),
    revision: integer("revision").notNull(),
    attachmentId: text("attachment_id")
      .notNull()
      .references(() => attachments.id),
  },
  (t) => [
    primaryKey({ columns: [t.publicationId, t.revision, t.attachmentId] }),
    index("attachment_references_attachment_idx").on(t.attachmentId),
  ],
);

// ---------------------------------------------------------------------------
// Reader preferences and bookmarks
// ---------------------------------------------------------------------------

export const userPreferences = sqliteTable("user_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  theme: text("theme", { enum: THEMES }).notNull().default("system"),
  /** Set when the personal dashboard is first seeded from the public layout. */
  layoutInitializedAt: timestamp("layout_initialized_at"),
  updatedAt: timestamp("updated_at").notNull(),
});

/** Personal dashboard panels: chosen categories and their order. */
export const userCategoryPanels = sqliteTable(
  "user_category_panels",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id),
    position: integer("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.categoryId] })],
);

/** Explicit interest filters: tags a reader selected. */
export const userInterestTags = sqliteTable(
  "user_interest_tags",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.tagId] })],
);

export const bookmarks = sqliteTable(
  "bookmarks",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    publicationId: text("publication_id")
      .notNull()
      .references(() => publications.id),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.publicationId] }), index("bookmarks_user_created_idx").on(t.userId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Operations: audit, publishing failures, rate limits
// ---------------------------------------------------------------------------

/** Account, role, credential, and publishing actions. No secrets or full request bodies. */
export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id"),
    actorKind: text("actor_kind", { enum: ACTOR_KINDS }).notNull(),
    credentialId: text("credential_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    details: text("details", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [index("audit_events_created_idx").on(t.createdAt), index("audit_events_target_idx").on(t.targetType, t.targetId)],
);

/** Bounded log (30-day retention) behind the owner's "recent publishing failures" view. */
export const publishingFailures = sqliteTable(
  "publishing_failures",
  {
    id: text("id").primaryKey(),
    operationId: text("operation_id").notNull(),
    userId: text("user_id"),
    credentialKind: text("credential_kind", { enum: CREDENTIAL_KINDS }),
    credentialId: text("credential_id"),
    operation: text("operation").notNull(),
    status: text("status").notNull(),
    message: text("message").notNull(),
    externalId: text("external_id"),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [index("publishing_failures_created_idx").on(t.createdAt)],
);

/** Per-member request counters shared across Worker instances. */
export const rateLimitCounters = sqliteTable(
  "rate_limit_counters",
  {
    userId: text("user_id").notNull(),
    bucket: text("bucket", { enum: ["requests", "writes", "uploads"] }).notNull(),
    windowStart: integer("window_start").notNull(),
    count: integer("count").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.bucket, t.windowStart] })],
);
