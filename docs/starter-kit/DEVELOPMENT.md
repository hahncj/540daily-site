# Development

Commands below come from the source app's `package.json`, config files, and docs. The **Status** column says whether each was **executed** while preparing this kit (against the source app, read-only) or only **inspected**.

## Prerequisites

- Node.js `>=22.12` (Docker uses Node 24) and npm `>=11`. If global npm is older: `npx npm@11 install`.
- A Cloudflare account (for deploy and remote D1/R2). Local dev needs no account.
- A Google OAuth client for sign-in (local origin `http://localhost:5173`).
- Optional: an Anthropic API key.
- Optional: Playwright browsers for browser tests: `npx playwright install chromium webkit`.
- Optional: build tools for `better-sqlite3` if no prebuilt binary matches (the Dockerfile installs `python3 make g++`).

## Install

```bash
npm install
```

## Local configuration

```bash
cp hosting/cloudflare/.dev.vars.example hosting/cloudflare/.dev.vars
```

Fill in `.dev.vars` (git-ignored). Variables:

| Name | Required | Purpose |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | Yes | `http://localhost:5173` locally |
| `ADMIN_EMAILS` | Yes | Comma-separated admin Google emails |
| `BETTER_AUTH_SECRET` | Yes | ≥ 32 random characters (`openssl rand -base64 32`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth client |
| `ANTHROPIC_API_KEY` | No | Turns on AI features |
| `ANTHROPIC_MODEL` | No | Model override (default `claude-opus-5-5`) |
| `ANTHROPIC_BASE_URL` | No | Gateway or mock only |
| `CLIENT_IP_HEADER` | No | Trusted client-IP header |
| `DATABASE_PATH`, `MIGRATIONS_DIR`, `MEDIA_DIR`, `PORT` | Node host only | SQLite file, migrations folder, file folder, port |

## Local database

```bash
npm run db:migrate:local
```

Applies `db/migrations/*.sql` to the local D1 emulation in `.wrangler/state`. `vite.config.ts` points the Cloudflare plugin at the same state folder (`persistState: { path: ".wrangler/state" }`), so the dev server sees the migrated database.

## Run

```bash
npm run dev
```

Starts `react-router dev` with `@cloudflare/vite-plugin`, running the Worker in workerd at `http://localhost:5173`. Bindings (`DB`, `MEDIA`) are emulated locally.

Optional Node host:

```bash
npm run build:node
```

```bash
npm run start:node
```

The Node host applies migrations at startup to `DATABASE_PATH` (default `data/<app>.db`).

## Command reference

| Command | What it runs | Status |
| --- | --- | --- |
| `npm run lint` | `eslint .` | **Executed**: passed, no output |
| `npm test` | `vitest run` (`tests/**/*.test.ts`, Node, in-memory SQLite) | **Executed**: 22 files, 229 tests passed in about 4 s |
| `npm run typegen` | `wrangler types -c hosting/cloudflare/wrangler.jsonc hosting/cloudflare/worker-configuration.d.ts && react-router typegen` | Inspected (not run: it rewrites a tracked file) |
| `npm run typecheck` | `npm run typegen && tsc` | Inspected |
| `npm run check` | `typecheck && lint && test` (run before calling work done) | Inspected (its lint and test parts were executed) |
| `npm run test:e2e` | `playwright test` (builds the Node host, starts servers on :3100, :3101, mock on :3102) | Inspected |
| `npm run smoke:ai` | `vitest run --config vitest.live.config.ts` (paid live Claude test) | Inspected (not run: costs money) |
| `npm run dev` | `react-router dev` | Inspected |
| `npm run build` | `react-router build` (Cloudflare target) | Inspected |
| `npm run build:node` | `BUILD_TARGET=node react-router build` | Inspected |
| `npm run start:node` | `node hosting/node/server.js` | Inspected |
| `npm run db:generate` | `drizzle-kit generate` | Inspected |
| `npm run db:migrate:local` | `wrangler d1 migrations apply <db> --local --persist-to .wrangler/state -c hosting/cloudflare/wrangler.jsonc` | Inspected |
| `npm run db:migrate:remote` | same with `--remote` | Inspected (never run; touches production) |
| `npm run auth:schema` | `auth generate --config scripts/auth-cli-config.ts --output server/db/auth-schema.ts --yes` | Inspected |
| `npm run deploy` | `npm run build && wrangler deploy` (no migrations) | Inspected |
| `npm run deploy:ci` | `wrangler d1 migrations apply <db> --remote … && wrangler deploy` | Inspected |

Single test file or test:

```bash
npx vitest run tests/server/items.test.ts -t "test name"
```

One Playwright project:

```bash
npx playwright test tests/e2e/items.spec.ts --project=desktop
```

## Type generation

- `wrangler types` writes `Env` (bindings + vars) to `hosting/cloudflare/worker-configuration.d.ts`. Commit it; it is in `tsconfig.json` `types` and ignored by ESLint.
- `react-router typegen` writes `.react-router/types/**` (git-ignored); routes import `./+types/<route>`.
- `tsconfig.json` (confirmed): `target`/`lib` ES2024 + DOM, `module` ES2022, `moduleResolution` bundler, `jsx` react-jsx, `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `isolatedModules`, `noEmit`, `skipLibCheck`, `rootDirs: [".", "./.react-router/types"]`, `types: ["node", "vite/client", "./hosting/cloudflare/worker-configuration.d.ts"]`.

## Formatting

**No formatter is configured** (no Prettier or similar in dependencies or config). Only ESLint. See DECISIONS_AND_GAPS.md G10.

## Browser tests (optional) in brief

`playwright.config.ts` starts three `webServer`s:

1. `node tests/e2e/mock-anthropic.mjs` on :3102 (stand-in for the Messages API, health at `/health`).
2. Deletes `.e2e/`, runs `npm run build:node`, starts the Node host on :3100 with test env (`ANTHROPIC_API_KEY=mock-key`, `ANTHROPIC_BASE_URL=http://localhost:3102`, `DATABASE_PATH=.e2e/<app>.db`, …).
3. A second empty instance on :3101 without an AI key (tests the "not configured" path and restore).

Projects: `setup` (seeds data through the app), then `phone-chromium`, `phone-webkit`, `tablet`, `desktop`, all depending on `setup`. `workers: 1`, `fullyParallel: false`. Test-only secrets in the config are dummy values.

## Git hygiene (from the source app's agent guide)

- Work on `feature/<name>` branches from an up-to-date `origin/main`; never commit to `main` directly.
- Stage files explicitly by path (no `git add -A`).
- Never commit `.dev.vars`, `.env`, `data/`, `.wrangler/`, `.e2e/`.
