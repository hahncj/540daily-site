# Stack

Which technologies 540 News uses and how to choose their versions. The library choices follow a pattern that worked in an earlier app. **Versions do not come from that app.** 540 News chooses its own versions when it is built.

## 1. Version policy

- **Stage 0 picks the versions.** Use the current stable release of each package, checked in the npm registry and the package's own docs at build time. Choose versions that work together: for example, a TypeScript version that typescript-eslint supports, a Vite version that React Router's and Cloudflare's Vite plugins support, and Better Auth plugins that match the Better Auth core version.
- **Pin exactly.** Use exact versions in `package.json` (no `^` or `~`), commit `package-lock.json`, and keep packages from one family (all `better-auth` / `@better-auth/*`, all `react-router` / `@react-router/*`) on matching versions.
- **Record the choices** in section 5 of this file: package, version, and date chosen. Note any package that had to be replaced and why.
- **Code samples are guidance, not a contract.** The samples in these docs show the API shapes the design relies on (for example `createMcpHandler`, `verifyJwsAccessToken`, the `mcp` and `cimd` plugins). If the chosen version's API differs, follow the current docs and keep the behavior the design describes. Record notable differences.
- **Never invent** packages, versions, or SDK methods. If something the design needs does not exist in a current release, stop and report it.
- Upgrades after launch are separate, tested changes.

## 2. Languages and runtimes

| Item | Choice | How to set the version |
| --- | --- | --- |
| TypeScript | Strict mode, ESM (`"type": "module"`) | Newest release supported by typescript-eslint |
| Node.js | Tooling, tests, and the Node test host | Current active LTS; set `engines` to match |
| npm | Package manager | The version bundled with that Node LTS or newer; set `engines` to match |
| Cloudflare Workers runtime | `nodejs_compat` flag | Set `compatibility_date` to the date the project is scaffolded |

Add an `allowScripts` block to `package.json` that allows install scripts only for the packages that need them (expected: `esbuild`, `better-sqlite3`, `workerd`, `fsevents`), at the versions the lockfile resolves.

## 3. Packages

### Runtime

| Package | Role |
| --- | --- |
| `react`, `react-dom` | UI; SSR with `renderToReadableStream` (works on Workers and Node) |
| `react-router` | Framework mode: routing, loaders/actions, SSR, `createRequestHandler` |
| `@modelcontextprotocol/server` | MCP TypeScript SDK: `McpServer` and a web-standard (`Request`/`Response`) Streamable HTTP handler with stateless mode |
| `zod` | Env parsing, input validation, MCP tool input schemas |
| `drizzle-orm` | ORM: `drizzle-orm/d1` on Workers, `drizzle-orm/better-sqlite3` in tests |
| `better-auth` | Google sign-in, sessions, JWT plugin, OAuth provider for MCP |
| `@better-auth/mcp` | OAuth 2.1 authorization server and protected-resource metadata for `/mcp` |
| `@better-auth/cimd` | Client ID Metadata Documents (how current MCP clients identify themselves) |
| `@better-auth/oauth-provider` | `verifyOAuthQueryParams` (consent page), `oauthProviderClient` (browser) |
| `@better-auth/core` | `isPublicRoutableHost`, used to guard outbound metadata fetches |
| `better-call` | Tests sign session cookies with `serializeSignedCookie`; match Better Auth's version |
| `better-sqlite3` | SQLite driver for tests and the Node test host (native module) |
| `@remix-run/node-fetch-server` | Node test host only: adapts `node:http` to fetch-style handlers |
| Markdown parser and HTML sanitizer (**to choose**) | Must run on Workers, turn off raw HTML, check link protocols, and allow rewriting `attachment:ID` image references |

If a Better Auth plugin has since been renamed or merged into the core package, use its current equivalent and record the change.

### Development

| Package | Role |
| --- | --- |
| `wrangler` | Local bindings, D1 migrations, secrets, deploy, `wrangler types` |
| `@cloudflare/vite-plugin` | Runs the app in workerd during `vite dev` and build |
| `@react-router/dev` | React Router CLI (`dev`, `build`, `typegen`) and Vite plugin |
| `vite` | Build tool |
| `drizzle-kit` | Generates SQL migrations from the schema |
| `auth` (Better Auth CLI) | Generates the auth tables' Drizzle schema |
| `vitest` | Unit and integration tests |
| `@playwright/test` | Browser tests |
| `@axe-core/playwright` | Accessibility checks in browser tests |
| `eslint`, `typescript-eslint` | Linting and the core-isolation rule |
| `@types/node`, `@types/react`, `@types/react-dom`, `@types/better-sqlite3` | Types |

Leave out packages nothing imports (the earlier app listed `@react-router/node` and `isbot` without using them).

## 4. Not part of the launch stack

- **No Anthropic SDK and no AI API key.** 540 News makes no in-app AI calls at launch. If AI features are added later, put them behind an interface in `server/core/` with an adapter in `server/ai/`, so core code never imports a provider SDK and tests use a fake.
- No KV, Durable Objects, Queues, cron triggers, or external databases.

## 5. Chosen versions

Filled in during Stage 0.

| Package or tool | Version | Date chosen | Notes |
| --- | --- | --- | --- |
| — | — | — | — |

## 6. Cloud and external services

| Service | Role |
| --- | --- |
| Cloudflare Workers | Hosts everything: SSR pages, MCP, OAuth, HTTP API, attachment routes, static assets |
| Cloudflare D1 | SQLite database (binding `DB`), including Better Auth tables and FTS5 search |
| Cloudflare R2 | Private attachment storage (binding `MEDIA`) |
| Cloudflare custom domain | `540news.com`; required for a stable OAuth and MCP origin |
| Workers observability logs | `"observability": { "enabled": true }` |
| Google OAuth | The only sign-in method for readers, editors, and the owner |
