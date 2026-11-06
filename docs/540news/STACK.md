# Stack

The stack and version pins below come from an earlier production app built on the same pattern. They have **not been verified for 540 News**. Before relying on a pin, check that it exists in the npm registry and works with the others. If a pin is unavailable, pick a coherent supported alternative and record the substitution and the reason in the completion report.

Keep exact pins (no `^` ranges) and keep all Better Auth packages on the same version. Upgrade later as separate, tested changes.

## Languages and runtimes

| Item | Version | Note |
| --- | --- | --- |
| TypeScript | 6.0.3 | 6.x chosen over 7 because typescript-eslint did not yet support 7 |
| Node.js | `>=22.12` (`engines`) | Used for tooling, tests, and the Node test host |
| npm | `>=11` (`engines`) | If the global npm is older: `npx npm@11 install` |
| Module system | ESM (`"type": "module"`) | |
| Cloudflare Workers runtime | `compatibility_date: "2026-11-01"`, `compatibility_flags: ["nodejs_compat"]` | Set in `wrangler.jsonc` |

Add an `allowScripts` block to `package.json` that allows install scripts only for `esbuild`, `better-sqlite3`, `workerd`, and `fsevents`, at the versions the lockfile resolves.

## Runtime dependencies

| Package | Version | Role |
| --- | --- | --- |
| `react`, `react-dom` | 19.3.1 | UI; SSR with `renderToReadableStream` (works on Workers and Node) |
| `react-router` | 8.5.1 | Framework mode: routing, loaders/actions, SSR, `createRequestHandler` |
| `@modelcontextprotocol/server` | 2.4.0 | MCP TypeScript SDK v2: `McpServer`, `createMcpHandler` |
| `zod` | 4.6.7 | Env parsing, input validation, MCP tool input schemas |
| `drizzle-orm` | 0.45.4 | ORM: `drizzle-orm/d1` on Workers, `drizzle-orm/better-sqlite3` in tests |
| `better-auth` | 1.7.15 | Google sign-in, sessions, JWT plugin, OAuth provider for MCP |
| `@better-auth/mcp` | 1.7.15 | OAuth 2.1 authorization server and protected-resource metadata for `/mcp` |
| `@better-auth/cimd` | 1.7.15 | Client ID Metadata Documents (how current MCP clients identify themselves) |
| `@better-auth/oauth-provider` | 1.7.15 | `verifyOAuthQueryParams` (consent page), `oauthProviderClient` (browser) |
| `@better-auth/core` | 1.7.15 | `isPublicRoutableHost`, used to guard outbound metadata fetches |
| `better-call` | 1.4.4 | Tests sign session cookies with `serializeSignedCookie`; match Better Auth |
| `better-sqlite3` | 13.0.3 | SQLite driver for tests and the Node test host (native module) |
| `@remix-run/node-fetch-server` | 0.14.2 | Node test host only: adapts `node:http` to fetch-style handlers |

Not needed: `@react-router/node` and `isbot` were listed in the earlier app but never imported. Leave them out unless the build needs them.

**Still to choose (no pin carried over):** a Markdown parser and HTML sanitizer that run on Workers. They must support turning off raw HTML, link-protocol checks, and rewriting `attachment:ID` image references. Record the choice and its version.

## Dev dependencies

| Package | Version | Role |
| --- | --- | --- |
| `wrangler` | 4.157.0 | Local bindings, D1 migrations, secrets, deploy, `wrangler types` |
| `@cloudflare/vite-plugin` | 1.67.0 | Runs the app in workerd during `vite dev` and build |
| `@react-router/dev` | 8.5.1 | React Router CLI (`dev`, `build`, `typegen`) and Vite plugin |
| `vite` | 8.3.5 | Build tool |
| `drizzle-kit` | 0.31.11 | Generates SQL migrations from the schema |
| `auth` | 1.7.15 | Better Auth CLI: generates the auth tables' Drizzle schema |
| `vitest` | 5.1.0 | Unit and integration tests |
| `@playwright/test` | 1.64.1 | Browser tests |
| `@axe-core/playwright` | 4.14.0 | Accessibility checks in browser tests |
| `eslint` | 10.14.0 | Linting |
| `typescript-eslint` | 8.72.1 | TS lint rules and the core-isolation rule |
| `@types/node` | 26.6.6 | |
| `@types/react`, `@types/react-dom` | 19.3.0 | |
| `@types/better-sqlite3` | 9.6.0 | |

Optional: `fflate` 0.8.3 if the backup export builds zip files in the browser.

## Not part of the launch stack

- **No Anthropic SDK and no AI API key.** 540 News makes no in-app AI calls at launch. If AI features are added later, put them behind an interface in `server/core/` with an adapter in `server/ai/`, so core code never imports a provider SDK and tests use a fake.
- No KV, Durable Objects, Queues, cron triggers, or external databases.

## Cloud and external services

| Service | Role |
| --- | --- |
| Cloudflare Workers | Hosts everything: SSR pages, MCP, OAuth, HTTP API, attachment routes, static assets |
| Cloudflare D1 | SQLite database (binding `DB`), including Better Auth tables and FTS5 search |
| Cloudflare R2 | Private attachment storage (binding `MEDIA`) |
| Cloudflare custom domain | `540news.com`; required for a stable OAuth and MCP origin |
| Workers observability logs | `"observability": { "enabled": true }` |
| Google OAuth | The only sign-in method for readers, editors, and the owner |
