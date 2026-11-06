# AGENTS.md

Guidance for coding agents working in this repository.

## Current state

Stage 0 (Foundation) is built: tooling, config, the full schema and migrations, Better Auth with the membership gate, the app shell, stub routes for every page, `Services` with a placeholder for every planned service, and test helpers. Later stages and lanes fill in the placeholders; see [docs/540daily/BUILD_PLAN.md](docs/540daily/BUILD_PLAN.md).

Stage 0 notes for later lanes:

- Node 26 LTS is required (Vitest 5 rejects Node 23). Versions and reasons are in [STACK.md section 5](docs/540daily/STACK.md).
- Planned services are `PlannedService` placeholders in `server/app.ts` that throw when called. Replace one with the real `createX()` from `server/core/` when you build it.
- `/mcp` and `/api/v1/*` return 503 and `/attachments/*` returns 404 until lanes 2A and 2B replace those branches in `handleRequest`.
- Tests sign in through Better Auth's real Google ID-token endpoint with `signInWithGoogle()`; only Google's signature check is replaced (`googleTestOverrides`). Use `sessionCookieFor()` when a test just needs a member.
- `npm run typegen` reads `.dev.vars.example` so the generated Worker types do not depend on a local `.dev.vars`.
- Playwright browsers are not installed by `npm install`: run `npx playwright install chromium webkit`.

## Document authority (read before building)

1. [docs/540daily/BUILD_PROMPT.md](docs/540daily/BUILD_PROMPT.md): entry point and build workflow. [docs/540daily/BUILD_PLAN.md](docs/540daily/BUILD_PLAN.md) splits the build into stages and parallel lanes; stay inside your lane's folders.
2. [docs/540daily/REQUIREMENTS.md](docs/540daily/REQUIREMENTS.md): **authoritative spec**. Wins over every other doc. "Default" items in it are authorized choices; do not reopen them.
3. Technical design, in this order: [STACK](docs/540daily/STACK.md), [ARCHITECTURE](docs/540daily/ARCHITECTURE.md), [MCP_AND_AUTH](docs/540daily/MCP_AND_AUTH.md), [DATA_AND_STORAGE](docs/540daily/DATA_AND_STORAGE.md), [IMPLEMENTATION_PATTERNS](docs/540daily/IMPLEMENTATION_PATTERNS.md), [DEVELOPMENT_AND_DEPLOYMENT](docs/540daily/DEVELOPMENT_AND_DEPLOYMENT.md). Items marked **Proposed** may be refined with a recorded reason.
4. [docs/540daily/DECISIONS.md](docs/540daily/DECISIONS.md): history only. Its open items are resolved by the requirements.

## What 540 Daily is

A public news/research dashboard at `https://540daily.com`. External AI agents publish stories and Markdown reports through MCP (`/mcp`) and an HTTP API (`/api/v1/*`). Readers browse category panels anonymously; invited readers (Google sign-in) get personal dashboards and bookmarks; editors author, edit, unpublish, and restore; one owner manages access and agent credentials.

## Stack

TypeScript (ESM), React Router framework mode (SSR) on one Cloudflare Worker, Better Auth (Google only, plus `mcp`/`cimd` plugins), the MCP TypeScript SDK (stateless), Drizzle ORM on D1 (SQLite) with FTS5 search, R2 for attachments. Tests: Vitest with in-memory better-sqlite3; Playwright against a Node build. Versions are chosen for this project, not copied from elsewhere: follow the version policy in [docs/540daily/STACK.md](docs/540daily/STACK.md), pin exactly, and record the chosen versions there.

**No Anthropic SDK or AI API key at launch.** Do not add in-app AI calls.

## Commands

From [docs/540daily/DEVELOPMENT_AND_DEPLOYMENT.md](docs/540daily/DEVELOPMENT_AND_DEPLOYMENT.md):

```bash
npm install
cp hosting/cloudflare/.dev.vars.example hosting/cloudflare/.dev.vars   # fill placeholders
npm run db:migrate:local      # apply migrations to local D1 in .wrangler/state
npm run dev                   # http://localhost:5173 (workerd via Vite plugin)
npm run check                 # typecheck + lint + test; run before calling work done
npm test                      # vitest run
npx vitest run tests/server/foo.test.ts -t "test name"   # single test
npm run test:e2e              # Playwright (builds Node host)
npx playwright test tests/e2e/foo.spec.ts --project=desktop
npm run db:generate           # drizzle-kit: SQL migration from schema changes
npm run auth:schema           # regenerate Better Auth tables (server/db/auth-schema.ts)
npm run typegen               # wrangler types + react-router typegen
```

Never run `db:migrate:remote`, `deploy`, `wrangler secret`, or any provisioning/DNS command without explicit owner authorization. No formatter is configured; only ESLint.

## Architecture rules

One Worker serves everything on one origin. `server/app.ts` `handleRequest` dispatches in order: `/health` → Better Auth (`/api/auth/*`, `/.well-known/*`) → `/mcp` → `/api/v1/*` → `/attachments/*` → React Router.

Layers (see [docs/540daily/ARCHITECTURE.md](docs/540daily/ARCHITECTURE.md)):

- `server/core/`: pure business rules and repository interfaces. It may import only zod and other core files. An ESLint rule enforces this.
- `server/adapters/`: Drizzle repositories, `atomic()` helper (D1 batch or SQLite transaction), media store.
- `server/mcp/` and `server/api-v1.ts`: thin. Parse input, call the **same core service**, format output. MCP and HTTP must return the same data shapes and validation errors.
- `hosting/cloudflare/worker.ts`: the only place that reads env/bindings. Config is parsed by a zod schema in `server/config.ts`.
- `app/`: UI. Reaches server code only through loaders, actions, and `*.server.ts` files. Routes are registered explicitly in `app/routes.ts`.

Rules that are easy to break:

- **Build `Services` (including the Better Auth instance) per request on Workers.** Caching it caused sign-in hangs in an earlier app built on this stack. Only parsed config may be cached.
- `atomic()` statements cannot use each other's results (D1 batch). Read first, then do conditional batch writes.
- Migrations only add tables, columns, and indexes. Commit `db/migrations/` including `meta/`.
- JWTs for MCP are verified in-process with `auth.api.getJwks()`; a Worker cannot fetch its own hostname.
- `wrangler d1 export` fails with FTS5 tables. Backup export/restore and performance testing are deferred; do not build them.

## Key product rules

From the requirements; easy to get wrong:

- Roles: visitor / invited reader / editor / owner / agent. Owner is bootstrapped from `OWNER_EMAIL`. Uninvited Google identities cannot create accounts. Do not treat every signed-in user as an admin.
- Agents act as the member who connected them (MCP via Google sign-in, or the member's hashed API key), with that member's current role. Agents only create publications and update the member's own; they never unpublish, restore, delete, or manage layout or access. Readers' agents are read-only.
- Create is idempotent per `(user_id, external_id)`, enforced by a DB unique index. Same payload replays the original; a different payload returns 409. Updates require `expectedRevision`.
- Every content/status change appends an immutable revision. Restore creates a new revision.
- Unpublished content and drafts are hidden from every public surface, including search, related items, bookmarks, and attachment URLs. Enforce on the server.
- Markdown is untrusted: no raw HTML, scripts, or iframes. Inline images only via `attachment:ID`. Attachments: PNG/JPEG/WebP, ≤10 MiB, signature-checked, alt text required, served from a private R2 bucket through access-checked routes.
- Public pages are indexable (no site-wide `noindex` header); private, editor, and auth pages are not.
- Resource names: Worker `540daily-site`, D1 `540daily-site-db`, R2 `540daily-site-media`. Never bind to the owner's other site's resources.

## Working conventions

- Files kebab-case; factories `createX()` returning objects of functions; data ports named `XRepository`; DB columns snake_case in SQL, camelCase in Drizzle; timestamps `integer(..., { mode: "timestamp_ms" })`.
- Tests: `*.test.ts` (Vitest), `*.spec.ts` (Playwright).
- Git: work on `feature/<name>` branches, never commit to `main` directly, stage files by path (no `git add -A`).
- Use placeholders for secrets, resource IDs, and the owner email. Label local fixtures as test data; never present invented stories as real news.
- Report checks honestly: distinguish fake/local tests from live verification, and never claim an unrun check passed.
