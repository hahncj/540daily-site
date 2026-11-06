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

| Package or tool | Version | Date chosen | Notes |
| --- | --- | --- | --- |
| Node.js | 26.13.0 (engines `^26.13.0`) | 2026-11-06 | Active LTS ("Lithium"). Vitest 5 does not support Node 23 |
| npm | 11.20.0 (engines `>=11.20.0`) | 2026-11-06 | Bundled with Node 26.13.0; supports the `allowScripts` field |
| TypeScript | 6.0.3 | 2026-11-06 | Newest release typescript-eslint 8.72.1 supports (`<6.1.0`); TypeScript 7.0.2 exists but is not yet supported by typescript-eslint |
| Workers `compatibility_date` | 2026-11-06 | 2026-11-06 | Scaffold date |
| react, react-dom | 19.3.1 | 2026-11-06 |  |
| react-router, @react-router/dev | 8.5.1 | 2026-11-06 | Framework mode; middleware and `RouterContextProvider` are on by default in v8 |
| @modelcontextprotocol/server | 2.4.0 | 2026-11-06 | Installed now so parallel lanes do not edit the lockfile; first used in lane 2A |
| zod | 4.6.7 | 2026-11-06 |  |
| drizzle-orm | 0.45.4 | 2026-11-06 | Matches better-auth's peer range (`^0.45.2`) |
| drizzle-kit | 0.31.11 | 2026-11-06 |  |
| better-auth, @better-auth/mcp, @better-auth/cimd, @better-auth/oauth-provider, @better-auth/core | 1.7.18 | 2026-11-06 | One family, one version. `auth` (CLI) is the same version |
| better-call | 1.4.5 | 2026-11-06 | The exact version better-auth 1.7.18 depends on |
| auth (Better Auth CLI) | 1.7.18 | 2026-11-06 | Replaces the older `@better-auth/cli` (last 1.4.21) |
| better-sqlite3 | 13.0.3 | 2026-11-06 | Tests and Node test host only |
| @remix-run/node-fetch-server | 1.0.0 | 2026-11-06 | Node test host only |
| wrangler | 4.156.1 | 2026-11-06 | Pinned to the exact version @cloudflare/vite-plugin 1.67.0 depends on, so one wrangler and one workerd are installed. 4.158.0 was current but installed a second copy |
| @cloudflare/vite-plugin | 1.67.0 | 2026-11-06 |  |
| vite | 8.3.6 | 2026-11-06 | Supported by React Router 8.5, the Cloudflare plugin, and Vitest 5 |
| vitest | 5.1.0 | 2026-11-06 |  |
| @playwright/test | 1.65.0 | 2026-11-06 | Needs Chromium build 1254 and WebKit 2388 (`npx playwright install chromium webkit`) |
| @axe-core/playwright | 4.14.0 | 2026-11-06 |  |
| eslint | 10.14.0 | 2026-11-06 |  |
| typescript-eslint | 8.72.1 | 2026-11-06 |  |
| @types/node | 26.6.6 | 2026-11-06 |  |
| @types/react, @types/react-dom | 19.3.0 | 2026-11-06 |  |
| @types/better-sqlite3 | 9.6.0 | 2026-11-06 |  |
| markdown-it (+ @types/markdown-it 14.2.0) | 15.0.3 | 2026-11-06 | Markdown parser. See below |
| xss | 1.0.17 | 2026-11-06 | HTML allowlist sanitizer. See below |

Install scripts are allowed only for `esbuild`, `workerd`, `better-sqlite3`, and `fsevents`, at the versions the lockfile resolves (`allowScripts` in `package.json`; manage with `npm install-scripts`). `esbuild@0.18.20` and `@0.25.12` come in through drizzle-kit.

**Markdown parser and sanitizer (chosen 2026-11-06).** `markdown-it` with `html: false` turns raw HTML into text, has a `validateLink` hook for the `http`/`https`/`mailto` allowlist, and lets the renderer replace the image rule so only `attachment:ID` images are rewritten and every other image is dropped. It is pure JavaScript with no Node built-ins, so it runs on Workers. `xss` (js-xss) then sanitizes the final HTML against an explicit tag and attribute allowlist as defense in depth. It is small and has no DOM or `postcss` dependency, unlike `sanitize-html` (pulls in `postcss` and `htmlparser2`) or DOMPurify (needs a DOM, which Workers lack). Stage 1 builds the renderer in `server/adapters/markdown.ts`.

**Notable API differences from the design samples (recorded for later lanes):**

- `@better-auth/mcp` 1.7 recommends serving MCP with `createMcpHandler(..., { legacy: "reject" })` behind `requireMcpAuth`, for the MCP 2026-07-28 protocol revision. The design sample uses `legacy: "stateless"`. Lane 2A decides, based on which clients must be supported.
- `cimd()` takes `metadataProfile: "mcp-2026-07-28"` for the current MCP revision.
- Better Auth's membership gate hook is `user.validateUserInfo({ user, source })`, returning `{ error, errorDescription }` to refuse. It runs before user creation, account linking, and each OAuth sign-in.
- Vite 8 bundles with Rolldown. React Router reads a custom server entry from `environments.ssr.build.rollupOptions.input` (used for the Node test host).

## 6. Cloud and external services

| Service | Role |
| --- | --- |
| Cloudflare Workers | Hosts everything: SSR pages, MCP, OAuth, HTTP API, attachment routes, static assets |
| Cloudflare D1 | SQLite database (binding `DB`), including Better Auth tables and FTS5 search |
| Cloudflare R2 | Private attachment storage (binding `MEDIA`) |
| Cloudflare custom domain | `540news.com`; required for a stable OAuth and MCP origin |
| Workers observability logs | `"observability": { "enabled": true }` |
| Google OAuth | The only sign-in method for readers, editors, and the owner |
