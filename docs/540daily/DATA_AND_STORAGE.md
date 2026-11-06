# Data and storage

How 540 Daily stores data in D1 and attachments in R2. The logical entities are listed in [REQUIREMENTS.md](REQUIREMENTS.md) section 7. **Proven** patterns worked in the earlier production app this design is based on; **Proposed** items are 540 Daily design choices the build agent may refine with a recorded reason.

Use only the dedicated resources: D1 `540daily-site-db` (binding `DB`) and R2 `540daily-site-media` (binding `MEDIA`). Never bind to another site's database or bucket.

## 1. Database client

- **Workers:** `drizzle(env.DB, { schema })` from `drizzle-orm/d1`, built per request in `worker.ts`. The binding is the connection; there is no pool.
- **Tests and Node test host:** `better-sqlite3` (`:memory:` or a file) with `drizzle-orm/better-sqlite3`. On a file database, set `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON`, and apply migrations at startup with `migrate(db, { migrationsFolder: "db/migrations" })`.
- One type covers both drivers:

```ts
// server/adapters/db.ts
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type * as schema from "../db/schema";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Database = BaseSQLiteDatabase<"sync" | "async", any, typeof schema>;
```

Always `await` queries; that works with both the async D1 driver and the sync SQLite driver.

## 2. Transactions: `atomic()` (proven)

D1 has no interactive transactions; it runs a `batch` as one transaction. better-sqlite3 has sync transactions. One helper covers both:

```ts
// server/adapters/atomic.ts
export async function atomic(db: Database, statements: Array<() => unknown>): Promise<unknown[]> {
  const anyDb = db as any;
  if (typeof anyDb.batch === "function") return anyDb.batch(statements.map((build) => build()));
  const results: unknown[] = [];
  anyDb.transaction(() => {
    for (const build of statements) {
      const query = build() as { run?: () => unknown } | undefined;
      results.push(typeof query?.run === "function" ? query.run() : query);
    }
  });
  return results;
}

/** Affected rows: D1 `{ meta: { changes } }` or better-sqlite3 `{ changes }`. */
export function changesOf(result: unknown): number {
  const v = result as { changes?: number; meta?: { changes?: number } } | undefined;
  return v?.meta?.changes ?? v?.changes ?? 0;
}
```

**Constraint:** statements in one `atomic()` call cannot read each other's results. Read first, then write in one batch. Use generated IDs (from `newId()`), conditional `WHERE` clauses, and subselects instead of reading back inserted rows.

### Applying it to 540 Daily writes (Proposed)

**Agent create with retry protection** ([REQUIREMENTS.md](REQUIREMENTS.md) A5):

1. Validate and normalize the payload in core. Compute a canonical hash of the create payload.
2. Read `submission_receipts` by `(user_id, external_id)`. If a receipt exists, return `replayed` with the original publication ID and current revision when the hash matches; otherwise return `conflict`.
3. Otherwise, in one `atomic()` batch:
   - `INSERT ... ON CONFLICT DO NOTHING` into `categories` (and `tags`) by normalized name;
   - insert the publication, with `category_id` taken from a subselect on the normalized name;
   - insert revision 1, the tag links, the attachment references, and the receipt.
4. If the batch fails on the receipt's unique index (a concurrent duplicate), the whole batch rolls back. Re-read the receipt and return `replayed` or `conflict` as in step 2.

The receipt and the publication commit together, so a failed attempt never leaves a receipt claiming success, and two concurrent identical creates produce one publication.

**Update with an expected revision** (A7): in one batch, update the publication `WHERE id = ? AND revision = expected` (setting `revision = expected + 1`), and insert the revision snapshot with `INSERT ... SELECT ... WHERE` that same condition still holds at the new revision. If `changesOf()` on the update is 0, return `conflict` with the current revision. Agent updates also include `AND created_by_user_id = ?` (the acting member) and never change visibility.

## 3. Schema conventions (proven)

- Text primary keys from `crypto.randomUUID()`, injected into core as `newId()`.
- Time as `integer(..., { mode: "timestamp_ms" })` in UTC; `now()` is injected into core.
- JSON columns via `text(..., { mode: "json" }).$type<T>()` (for example, revision snapshots and source lists).
- Enums via `text(..., { enum: [...] })`. SQLite does not enforce them, so validate in core.
- Case-insensitive uniqueness: `uniqueIndex(...).on(sql\`${t.normalizedName} collate nocase\`)`. Store the normalized name (Unicode NFC or NFKC, trimmed, whitespace collapsed) in its own column; the display label is kept separately.
- Idempotency: `uniqueIndex` on `(user_id, external_id)` in `submission_receipts`, so retries through any of a member's connections or keys match.
- Revision history: a separate append-only table of JSON snapshots (`publication_revisions`: publication ID, revision number, snapshot, status, actor kind and ID, created at). Unique on `(publication_id, revision)`.
- Bookmarks: unique on `(user_id, publication_id)`.
- Visibility: a `status` column (`draft`, `published`, `unpublished`) on publications. There is no hard delete at launch.

```ts
// server/db/schema.ts
export * from "./auth-schema";   // generated by the Better Auth CLI
export * from "./app-schema";
```

Auth tables are generated into `server/db/auth-schema.ts` by `npm run auth:schema` and included in a normal Drizzle migration. They live in the same D1 database as the app tables.

## 4. Migrations (proven)

- `drizzle.config.ts`: `{ dialect: "sqlite", schema: "./server/db/schema.ts", out: "./db/migrations" }`.
- After schema changes: `npm run db:generate` (`drizzle-kit generate`). Commit the `.sql` file **and** `db/migrations/meta/`.
- On Cloudflare, Wrangler applies migrations. `migrations_dir` in `wrangler.jsonc` is `../../db/migrations` (relative to the config file), and Wrangler records applied files in a `d1_migrations` table.
- In tests and the Node host, Drizzle's `migrate()` reads the same folder.
- Custom SQL (FTS5 tables, triggers, the one-time category seed) goes in its own migration file (`drizzle-kit generate --custom`), with statements separated by `--> statement-breakpoint` lines.
- Never edit an applied migration; add a new one. Migrations only **add** tables, columns, and indexes, so the running version keeps working during a deploy.

**Seed data:** the five starting categories (Technology, Business, Finance, Sports, Entertainment) and their homepage layout entries are inserted once by a migration, as the requirements specify. No sample publications go into migrations. Tests create their own data through core functions, and Playwright seeds through the running app. Label all fixture content as test data.

## 5. Search: FTS5 (proven pattern, adapted)

Index only the **current published** title, summary, and body:

```sql
CREATE VIRTUAL TABLE `publications_fts` USING fts5(
  `publication_id` UNINDEXED, `title`, `summary`, `body`,
  tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3');
--> statement-breakpoint
CREATE TRIGGER `publications_fts_insert` AFTER INSERT ON `publications` WHEN new.`status` = 'published' BEGIN
  INSERT INTO `publications_fts` (`publication_id`, `title`, `summary`, `body`)
  VALUES (new.`id`, new.`title`, new.`summary`, coalesce(new.`body_markdown`, ''));
END;
--> statement-breakpoint
CREATE TRIGGER `publications_fts_update` AFTER UPDATE ON `publications` BEGIN
  DELETE FROM `publications_fts` WHERE `publication_id` = old.`id`;
  INSERT INTO `publications_fts` (`publication_id`, `title`, `summary`, `body`)
  SELECT new.`id`, new.`title`, new.`summary`, coalesce(new.`body_markdown`, '') WHERE new.`status` = 'published';
END;
```

Triggers keep the index in step with content and status changes inside the same transaction. Revisions are never indexed.

Query: `` sql`${publications.id} in (select publication_id from publications_fts where publications_fts match ${matchExpression})` ``. Build the match expression in code from sanitized user words; never pass raw input to `MATCH`. With a keyword, order by relevance (`bm25`), then newest. Without one, order by `published_at DESC, id DESC`. Filters combine with AND. Convert the inclusive America/Chicago date range to UTC bounds in core.

## 6. Data access pattern (proven)

Core defines the interface; an adapter implements it with Drizzle.

```ts
// server/core/publications.ts (no drizzle imports)
export interface PublicationsRepository {
  getPublic(id: string): Promise<Publication | null>;            // status = published only
  getForCreator(id: string, userId: string): Promise<Publication | null>;   // the member's own, any status
  getForEditor(id: string): Promise<Publication | null>;
  findReceipt(userId: string, externalId: string): Promise<Receipt | null>;
  createWithReceipt(input: NewPublication, receipt: NewReceipt | null): Promise<"created" | "duplicate">;
  updateIfRevision(id: string, expected: number, changes: PublicationChanges, actor: Actor, onlyCreatorId?: string): Promise<boolean>;
}
```

Validation happens in core before the repository is called. Public read methods filter on `status = 'published'` in SQL, so drafts and unpublished items cannot leak through any public surface.

## 7. Attachments in R2

```ts
// server/adapters/media.ts (proven)
export interface MediaStore {
  put(key: string, body: ArrayBuffer | Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: ReadableStream; contentType: string; size: number } | null>;
  delete(key: string): Promise<void>;
  ping(): Promise<void>;              // for /health
}
```

- R2 implementation: `bucket.put(key, body, { httpMetadata: { contentType } })`, `bucket.get`, `bucket.delete`, and `bucket.list({ limit: 1 })` for ping. The binding is the credential; there are no access keys.
- A filesystem implementation for the Node test host (with path-traversal checks) and an in-memory fake for Vitest.
- The bucket is **private**; there is no public bucket URL. Files are served only through `GET /attachments/:id`, which checks visibility first:
  - referenced by a current **published** version → serve with `Cache-Control: public, max-age=300` (**Proposed**: short, so unpublishing takes effect quickly; do not use `immutable`);
  - otherwise → serve only to editors and the uploading member, with `Cache-Control: private, no-store`; everyone else gets 404.
- Upload checks: PNG, JPEG, or WebP only; at most 10 MiB; verify the magic bytes, not just the extension or the declared type; alt text required. Store the SHA-256 digest and size. Never accept SVG or HTML.
- Keep any image resizing out of the Worker (CPU limit). Agents and editors upload images at their final size.

## 8. Local development and tests

| Context | Database | Attachments | How |
| --- | --- | --- | --- |
| `npm run dev` | Local D1 emulated in `.wrangler/state` | Local R2 emulation in the same folder | `@cloudflare/vite-plugin` with `persistState: { path: ".wrangler/state" }`; run `npm run db:migrate:local` first |
| Vitest | `better-sqlite3` `:memory:` with real migrations, per test | In-memory `MediaStore` | `createTestServices()` |
| Playwright | SQLite file in `.e2e/` (deleted each run), Node build | Folder in `.e2e/` | `webServer` in `playwright.config.ts` |

No Docker is needed for development.
