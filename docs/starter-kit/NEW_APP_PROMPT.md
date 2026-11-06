# New app prompt

Fill in every `<…>` placeholder, then give everything below the line to a coding agent working in a fresh repository that contains this `starter-kit/` folder.

---

You are building a new web application in this repository. The `starter-kit/` folder describes the stack, architecture, and integration patterns you must follow. It is your only reference; you do not have access to the app it was derived from.

## The app

- **Name:** `<APP_NAME>` (package/worker slug: `<app-name>`)
- **Purpose:** `<ONE_OR_TWO_SENTENCES>`
- **Intended users:** `<WHO_USES_IT>` (admins are listed in `ADMIN_EMAILS`)
- **Core features:**
  1. `<FEATURE_1>`
  2. `<FEATURE_2>`
  3. `<FEATURE_3>`
- **Constraints:** `<CONSTRAINTS>` (for example: Workers free plan, public vs. sign-in-only pages, data rules)

## New cloud resources and settings (all separate from any existing app)

| Setting | Value |
| --- | --- |
| Cloudflare Worker name | `<WORKER_NAME>` |
| Custom domain | `<APP_DOMAIN>` |
| D1 database name | `<D1_DATABASE_NAME>` |
| D1 database ID | `<D1_DATABASE_ID>` (from `wrangler d1 create`; leave as placeholder until provisioned) |
| R2 bucket (optional) | `<R2_BUCKET_NAME>` or "none" |
| MCP server name | `<MCP_SERVER_NAME>` |
| Admin emails | Provided as a secret, never committed |
| Google OAuth client | New client for `<APP_DOMAIN>` and `http://localhost:5173` |
| Anthropic API key | New key, stored as a Worker secret |
| Claude model | `claude-opus-5-5` unless `<MODEL_OVERRIDE>` |

## Requirements

1. **Read the kit first**, in the order given in `starter-kit/README.md`. Follow its stack (exact versions in `STACK.md`), folder layout (`PROJECT_STRUCTURE.md`), and conventions (`IMPLEMENTATION_PATTERNS.md`). Do not upgrade dependencies or swap frameworks.
2. **Preserve the MCP and Claude pattern** (`MCP_AND_CLAUDE.md`):
   - One Cloudflare Worker serves the React Router v8 SSR frontend, the MCP endpoint `POST /mcp`, Better Auth at `/api/auth/*` and `/.well-known/*`, and any APIs, all on one origin.
   - MCP uses `@modelcontextprotocol/server` `createMcpHandler(factory, { legacy: "stateless" })`, a new `McpServer` per request, zod input shapes, `{ content, structuredContent, isError }` results, and the exact 401 `WWW-Authenticate` challenge.
   - MCP clients authenticate with OAuth 2.1 from Better Auth (`jwt`, `mcp`, `cimd` plugins, Google sign-in, `/sign-in` and `/consent` pages). Tokens are verified in-process with the JWKS from the database, audience `<APP_ORIGIN>/mcp`, and the admin allow-list is re-checked on every call.
   - MCP tools are thin: they call core services shared with the UI.
   - Claude is called only from backend code through an AI port in `server/core/ai.ts`, implemented in `server/ai/anthropic.ts` with `client.beta.messages.parse` and `betaZodOutputFormat`. The API key is a Worker secret. The browser calls same-origin routes only. AI routes check admin access (401/403) before any Claude call and return 503 when no key is set.
3. **Preserve the data and cloud pattern** (`DATABASE_AND_CLOUD.md`): Cloudflare D1 via Drizzle (`drizzle-orm/d1` in the Worker, `better-sqlite3` in tests), one schema in `server/db/`, `drizzle-kit generate` SQL migrations in `db/migrations/` applied by Wrangler, `atomic()` for multi-statement writes, R2 behind a `MediaStore` interface only if files are needed. Build services per request in the Worker.
4. **Use only new resources and credentials.** Put placeholders in committed files. Never reuse any existing database, bucket, Worker, domain, OAuth client, or key.
5. **Scaffold the app and build one minimal feature through every boundary:**
   - A page that lists and creates `<PRIMARY_ENTITY>` records (D1 via core + repository).
   - An MCP tool pair: `search_<entities>` (read-only) and `create_<entity>` (write, with an idempotency key), calling the same core service.
   - One admin-only AI action at `POST /api/ai/<feature>` that sends a record to Claude and returns a structured suggestion, which the user can then save through a normal form action.
   - `/health` reporting database status.
6. **Define a minimal schema** for `<PRIMARY_ENTITY>` (id, title or name, a few fields, `revision`, timestamps, `created_by`/`updated_by`, optional `deleted_at`), plus `settings` if needed. Generate the Better Auth tables with `npm run auth:schema`, then generate the first migration.
7. **Provide setup instructions** in the README and a `hosting/cloudflare/.dev.vars.example` with safe placeholders only (`PUBLIC_BASE_URL`, `ADMIN_EMAILS`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, optional `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`). Add the `.gitignore` entries from the kit. Add an `AGENTS.md` with commands and architecture rules, and a `CLAUDE.md` containing `@AGENTS.md`.
8. **Verify** each boundary (see `MCP_AND_CLAUDE.md` section 9):
   - MCP: 401 challenge header, both `.well-known` documents, `initialize` + `tools/list`, a full in-process OAuth flow (`connectTool`), and `tools/call` writing to and reading from the database.
   - Frontend → backend: route actions called directly in tests; signed out → 401, non-admin → 403, `FakeAi.calls` empty in both.
   - Backend → Claude: `FakeAi` in route/core tests; a live smoke test in `tests/live/` that is skipped without `ANTHROPIC_API_KEY`.
   - Migrations: `createTestServices()` applies them to in-memory SQLite in every test; `npm run db:migrate:local` succeeds.
   - Database access: repository tests read back what they write, including a revision conflict.
   - Run `npm run check` and report the result.
9. **Report honestly.** List which checks ran against fakes or mocks, which ran live, and which were not run (for example, deploying, remote migrations, a real Claude.ai connector, Google sign-in). Do not claim a check passed unless you ran it.
10. **Ask only for essential missing information, one question at a time**, with a recommended option. Keep working on independent parts while waiting. Do not run commands that touch Cloudflare remote resources, set secrets, or deploy without explicit approval.

## Done means

- `npm run check` passes.
- The minimal feature works in `npm run dev` with local D1.
- Tests prove the MCP OAuth flow, tool calls, admin gating, the AI route with a fake, and migrations.
- README explains setup, provisioning (with placeholders), and deploy.
- A short report lists what was verified, how (mocked or live), and what remains unverified.
