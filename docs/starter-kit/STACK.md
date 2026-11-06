# Stack

All versions below are **confirmed** from the source app's `package.json` (exact pins) and `package-lock.json` (lockfile v3). Use the same versions. Do not upgrade while scaffolding; upgrade later as a separate, tested change.

## Languages, runtimes, package manager

| Item | Version | Evidence / note |
| --- | --- | --- |
| TypeScript | 6.0.3 | Pinned. The source notes 6.0 was chosen over 7 because typescript-eslint did not support 7 yet |
| Node.js | `>=22.12` (`engines`) | Docker image uses `node:24-slim`. The machine that prepared this kit had v23.11.0 |
| npm | `>=11` (`engines`) | Docker installs `npm@11.21.1`. The kit-preparation machine had 11.21.1 |
| Module system | ESM (`"type": "module"`) | |
| Cloudflare Workers runtime | `compatibility_date: "2026-11-01"`, `compatibility_flags: ["nodejs_compat"]` | From `wrangler.jsonc` |
| workerd (local runtime) | 1.20261101.1 | Resolved in lockfile (pulled in by Wrangler) |

`package.json` also has an `allowScripts` block that allows install scripts only for `esbuild`, `better-sqlite3`, `workerd`, and `fsevents` (exact versions). Keep this approach; update the version keys to whatever the lockfile resolves in the new repo.

## Required runtime dependencies

| Package | Version | Role |
| --- | --- | --- |
| `react`, `react-dom` | 19.3.1 | UI; server rendering with `renderToReadableStream` (works on Workers and Node) |
| `react-router` | 8.5.1 | Framework mode: routing, loaders/actions, SSR, `createRequestHandler` |
| `@react-router/node` | 8.5.1 | Listed, but not imported by any source file (likely a template default; see DECISIONS_AND_GAPS.md G9) |
| `isbot` | `^5` (resolved 5.2.2) | Listed, but not imported: the custom `entry.server.tsx` does not use it (G9). Only unpinned dependency |
| `@modelcontextprotocol/server` | 2.4.0 | MCP TypeScript SDK v2: `McpServer`, `createMcpHandler` (web-standard `Request`/`Response`) |
| `@anthropic-ai/sdk` | 1.4.0 | Claude API client; `client.beta.messages.parse` with `betaZodOutputFormat` |
| `zod` | 4.6.7 | Env validation, MCP tool input schemas, Claude structured-output schemas, input validation |
| `drizzle-orm` | 0.45.4 | ORM; `drizzle-orm/d1` on Workers, `drizzle-orm/better-sqlite3` on Node/tests |
| `better-auth` | 1.7.15 | Google sign-in, sessions, JWT plugin, OAuth provider for MCP |
| `@better-auth/mcp` | 1.7.15 | `mcp()` plugin: OAuth 2.1 authorization server + protected-resource metadata for `/mcp` |
| `@better-auth/cimd` | 1.7.15 | Client ID Metadata Documents (current MCP client identification) |
| `@better-auth/oauth-provider` | 1.7.15 | `verifyOAuthQueryParams` (consent page), `oauthProviderClient` (browser client), types |
| `@better-auth/core` | 1.7.15 | `isPublicRoutableHost` used for SSRF guards |
| `better-call` | 1.4.4 | Used by tests to sign a session cookie (`serializeSignedCookie`); pinned to match Better Auth |
| `better-sqlite3` | 13.0.3 | SQLite driver for tests and the Node host (native module) |
| `@remix-run/node-fetch-server` | 0.14.2 | Node host only: adapts `node:http` to fetch-style handlers |

All Better Auth packages are pinned to the **same** version. Keep them in lockstep.

## Required dev dependencies

| Package | Version | Role |
| --- | --- | --- |
| `wrangler` | 4.157.0 | Cloudflare CLI: dev bindings, D1 migrations, secrets, deploy, `wrangler types` |
| `@cloudflare/vite-plugin` | 1.67.0 | Runs the app in workerd during `vite dev`/build; reads `wrangler.jsonc` |
| `@react-router/dev` | 8.5.1 | React Router CLI (`react-router dev/build/typegen`) and Vite plugin |
| `vite` | 8.3.5 | Build tool |
| `drizzle-kit` | 0.31.11 | `drizzle-kit generate` creates SQL migrations from the schema |
| `auth` | 1.7.15 | Better Auth CLI: generates the auth tables' Drizzle schema |
| `vitest` | 5.1.0 | Unit and integration tests |
| `@playwright/test` | 1.64.1 | Browser tests |
| `@axe-core/playwright` | 4.14.0 | Accessibility checks in browser tests (optional) |
| `eslint` | 10.14.0 | Linting |
| `typescript-eslint` | 8.72.1 | TS lint rules; also hosts the core-isolation rule |
| `@types/node` | 26.6.6 | |
| `@types/react`, `@types/react-dom` | 19.3.0 | |
| `@types/better-sqlite3` | 9.6.0 | |

## Optional dependencies

| Package | Version | Role | When to include |
| --- | --- | --- | --- |
| `fflate` | 0.8.3 | Zip in the browser (backup export/restore) | Only if you build browser-side zip backups |

## Business-specific dependencies (do not copy)

| Package | Why excluded |
| --- | --- |
| `@fontsource-variable/newsreader`, `@fontsource-variable/public-sans` | The source app's brand fonts. Choose your own |

## Cloud services

| Service | Role | Required? |
| --- | --- | --- |
| Cloudflare Workers | Hosts everything (SSR, MCP, OAuth, APIs, static assets) | Required |
| Cloudflare D1 | SQLite database | Required |
| Cloudflare R2 | Object storage for user files | Optional |
| Cloudflare Workers Builds | CI/CD from GitHub (configured in the dashboard, not in a repo file) | Required for the documented deploy flow |
| Cloudflare custom domain route | Domain + certificate | Required for a stable MCP/OAuth origin |
| Workers observability logs | `"observability": { "enabled": true }` | Recommended |

## External services

| Service | Role | Required? |
| --- | --- | --- |
| Anthropic Claude API | Backend AI calls | Required for AI features (app still runs without a key) |
| Google OAuth (Google Cloud Console) | Admin sign-in identity provider | Required by the source pattern (see DECISIONS_AND_GAPS.md G5) |

## Model configuration (confirmed)

- Default model: `claude-opus-5-5` (constant `DEFAULT_MODEL` in the Anthropic adapter).
- Override with env var `ANTHROPIC_MODEL`.
- Optional `ANTHROPIC_BASE_URL` for a gateway or a test mock.
