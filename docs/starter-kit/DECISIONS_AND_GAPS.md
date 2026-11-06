# Decisions and gaps

## Observed design choices and their rationale

"Stated" means the reason is written in a code comment or doc in the source repo. "Inferred" means it is our reading.

| # | Observed choice | Rationale | Source of rationale |
| --- | --- | --- | --- |
| C1 | One Worker serves pages, MCP, OAuth, and APIs on one origin | OAuth issuer, MCP resource, and Google redirect must share `PUBLIC_BASE_URL`; free plan; simple deploy | Inferred (free plan stated) |
| C2 | Services built per request on Workers | Reusing a Better Auth instance leaked lazy init between requests; sign-in hung | Stated (`worker.ts` comment) |
| C3 | MCP stateless (`legacy: "stateless"`), new `McpServer` per request | Serve 2025-era and 2026-07-28 clients; no Durable Objects or Express | Stated (comment + plan stack table) |
| C4 | JWT verified in-process with `auth.api.getJwks()` | A Worker cannot fetch its own hostname | Stated (`mcp/endpoint.ts`, `tool-auth.ts`) |
| C5 | CIMD + dynamic client registration | CIMD is the current MCP mechanism; DCR kept for older clients | Stated (`auth.ts`) |
| C6 | Admin allow-list checked at sign-in and on every request and tool call | Removing an email cuts off sessions and tools | Stated |
| C7 | AI behind a port with a not-configured stub | Tests never call Claude; app works without a key | Stated |
| C8 | Structured outputs via `messages.parse` + zod | Reliable fields | Stated (plan) |
| C9 | No streaming | — | Not stated. Inferred: structured JSON results are used whole; UI shows a wait message |
| C10 | Core isolation lint rule | Portability between hosts and providers | Stated |
| C11 | Same SQLite schema for D1 and better-sqlite3 | One migration history for both hosts; fast in-memory tests | Stated (`drizzle.config.ts`) |
| C12 | `atomic()` helper | D1 uses batch; better-sqlite3 uses transactions | Stated |
| C13 | Browser does heavy CPU work (image resize, zip) | ~10 ms CPU limit on Workers free plan | Stated |
| C14 | Migrations applied in `deploy:ci` before deploy | Earlier production incidents with skipped migrations | Stated (agent guide) |
| C15 | Only add tables/columns/indexes in migrations | Old version keeps working during deploy | Stated (deployment doc) |
| C16 | Previews build-only | No preview-only resources; Google OAuth has no wildcard redirects | Stated |
| C17 | Tool writes go to an approval queue (business feature) | Owner approves AI-submitted changes | Stated; business-specific, optional |

## Gaps, discrepancies, and constraints

| # | Item | Impact | Kit's handling |
| --- | --- | --- | --- |
| G1 | "Frontend MCP server" wording vs. code. The MCP server runs server-side in the same Worker that renders the frontend, at `/mcp` on the app's origin; nothing MCP runs in the browser. The frontend's role is the `/sign-in` and `/consent` pages of the OAuth flow. | **Resolved (owner, 2026-11-05):** the requirement only means the app exposes an MCP server so agents such as Claude and ChatGPT can integrate with it. The code's pattern meets it | Kit preserves the actual pattern |
| **G2** | **No flow combines MCP and Claude.** MCP tools only read and write data; Claude is used only from admin UI routes. | The required "one trace through MCP and Claude" does not exist | Kit gives two separate traces. If the new app needs a tool that calls Claude, it is a new design: decide rate limits and cost controls first (tool calls are not gated by a browser session) |
| G3 | No Claude streaming or cancellation (no `AbortSignal`) | Long calls (up to 240 s) block the request | Documented as-is; streaming is an optional improvement |
| G4 | No MCP `outputSchema`, prompts, or resources; tools only | — | Documented |
| G5 | Better Auth with **Google** is the only sign-in method; email/password disabled | The new app needs a Google OAuth client, or a deliberate change of provider | Kit keeps Google as baseline |
| G6 | Business-specific approval queue for tool writes | Not needed for every app | Kit shows a direct-write tool; queue is optional |
| G7 | **No CI tests.** Workers Builds only builds and deploys; tests are run locally | Regressions can reach `main` | Optional improvement: add a CI job running `npm run check` |
| G8 | Plan document mentions "React Aria components" and a `server/api/` folder; neither exists (no `react-aria` dependency; HTTP API is `server/api-v1.ts`) | Docs drift | Kit follows the code |
| G9 | `isbot` (`^5`, the only unpinned dep) and `@react-router/node` are dependencies but no source file imports them | Possibly unneeded | Kit lists them as present-but-unused; the new app may omit them after checking the build |
| G10 | No formatter configured | Style drift | Optional: add one, as a separate decision |
| G11 | `wrangler.jsonc` has no `assets` block; static asset serving in production is presumably handled by the Cloudflare Vite plugin's build output | Not verified from repo | Verify after the first `npm run build` in the new repo |
| G12 | `atomic()` statements cannot depend on each other's results (D1 batch) | Constrains write logic | Documented pattern: read, then conditional batch writes |
| G13 | `wrangler d1 export` fails with FTS5 virtual tables | Backups | Use Time Travel or an app-level export |
| G14 | `authInfo.token` is passed as `""` and `scopes` as `[]` to the MCP handler | Tools cannot use scopes | Documented as-is |
| G15 | Exact behavior of each Better Auth endpoint beyond what tests assert (e.g. refresh-token lifetimes, rate limits) | Unknown | Not documented; check Better Auth 1.7.15 docs |
| G16 | Workers free-plan CPU limit (~10 ms). Source docs record measured production medians of 11–34 ms in an early check | Heavier apps may need the paid plan | Keep server work light; measure after deploy |
| G17 | The source repo's committed `wrangler.jsonc` contains its real D1 database ID and domain | Risk of accidental reuse | Kit uses placeholders only |

## Optional improvements (not part of the baseline)

- CI job for `npm run check` (and optionally `npm run test:e2e`).
- Streaming Claude responses for long tasks, with `AbortSignal` from `request.signal`.
- MCP `outputSchema` per tool.
- A formatter.
- Preview environments with their own D1/R2 (`previews` block).
- Removing unused dependencies (G9) after verifying.

## Open questions

None. Q1 (meaning of "frontend MCP server") was answered by the owner on 2026-11-05: it means the app exposes an MCP server for agent integrations (Claude, ChatGPT). See G1.
