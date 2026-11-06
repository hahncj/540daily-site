# Development and deployment

How to run 540 News locally, provision its Cloudflare resources, and deploy it. Commands and setup come from the earlier production app this design is based on, renamed for 540 News. None of them have been run for this project yet; the build agent should confirm each one as the code takes shape.

**Never run** remote migrations, `wrangler deploy`, `wrangler secret put`, resource creation, or DNS changes without the owner's explicit approval. Always pass `--name 540news-site` or `-c hosting/cloudflare/wrangler.jsonc` to Wrangler, so a command cannot hit another Worker in the same account.

## 1. Prerequisites

- Node.js and npm at the versions set in `package.json` `engines` (see [STACK.md](STACK.md)).
- Local development needs no Cloudflare account. Deploying needs the owner's account.
- A Google OAuth client for sign-in (local origin `http://localhost:5173`).
- Playwright browsers for browser tests: `npx playwright install chromium webkit`.
- Build tools for `better-sqlite3` if no prebuilt binary matches (`python3`, `make`, `g++`).

## 2. Local setup

```bash
npm install
```

```bash
cp hosting/cloudflare/.dev.vars.example hosting/cloudflare/.dev.vars
```

```bash
# hosting/cloudflare/.dev.vars.example — copy to .dev.vars (git-ignored). Placeholders only.
PUBLIC_BASE_URL=http://localhost:5173
OWNER_EMAIL=owner@example.com
# openssl rand -base64 32
BETTER_AUTH_SECRET=replace-with-at-least-32-random-characters
GOOGLE_CLIENT_ID=replace-me.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=replace-me
# Optional overrides
# CLIENT_IP_HEADER=cf-connecting-ip
# RATE_LIMIT_REQUESTS_PER_MIN=60
# RATE_LIMIT_WRITES_PER_MIN=10
# RATE_LIMIT_UPLOADS_PER_MIN=5
```

The Node test host also reads `DATABASE_PATH`, `MIGRATIONS_DIR`, `MEDIA_DIR`, and `PORT`.

```bash
npm run db:migrate:local
```

```bash
npm run dev
```

`npm run dev` starts `react-router dev` with `@cloudflare/vite-plugin`, running the Worker in workerd at `http://localhost:5173`. The `DB` and `MEDIA` bindings are emulated in `.wrangler/state`, the same folder the migrate command writes to.

## 3. Commands

| Command | Runs |
| --- | --- |
| `npm run dev` | `react-router dev` |
| `npm run build` | `react-router build` (Cloudflare target) |
| `npm run build:node` | `BUILD_TARGET=node react-router build` (Node test host) |
| `npm run start:node` | `node hosting/node/server.js` |
| `npm run typegen` | `wrangler types -c hosting/cloudflare/wrangler.jsonc hosting/cloudflare/worker-configuration.d.ts && react-router typegen` |
| `npm run typecheck` | `npm run typegen && tsc` |
| `npm run lint` | `eslint .` |
| `npm test` | `vitest run` (`tests/**/*.test.ts`, in-memory SQLite) |
| `npm run check` | `typecheck && lint && test`. Run before calling work done |
| `npm run test:e2e` | `playwright test` (builds and starts the Node host) |
| `npm run db:generate` | `drizzle-kit generate` |
| `npm run db:migrate:local` | `wrangler d1 migrations apply 540news-site-db --local --persist-to .wrangler/state -c hosting/cloudflare/wrangler.jsonc` |
| `npm run db:migrate:remote` | Same with `--remote`. Production; owner approval required |
| `npm run auth:schema` | `auth generate --config scripts/auth-cli-config.ts --output server/db/auth-schema.ts --yes` |
| `npm run deploy` | `npm run build && wrangler deploy` (does not migrate) |
| `npm run deploy:ci` | `wrangler d1 migrations apply 540news-site-db --remote -c hosting/cloudflare/wrangler.jsonc && wrangler deploy` |

Single test or file:

```bash
npx vitest run tests/server/publications.test.ts -t "A5"
```

```bash
npx playwright test tests/e2e/dashboard.spec.ts --project=desktop
```

## 4. Types and TypeScript settings

- `wrangler types` writes `Env` (bindings and vars) to `hosting/cloudflare/worker-configuration.d.ts`. Commit it; ESLint ignores it.
- `react-router typegen` writes `.react-router/types/**` (git-ignored); routes import `./+types/<route>`.
- `tsconfig.json`: `target`/`lib` ES2024 + DOM, `module` ES2022, `moduleResolution` bundler, `jsx` react-jsx, `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `isolatedModules`, `noEmit`, `skipLibCheck`, `rootDirs: [".", "./.react-router/types"]`, `types: ["node", "vite/client", "./hosting/cloudflare/worker-configuration.d.ts"]`.

## 5. Browser tests

`playwright.config.ts` deletes `.e2e/`, runs `npm run build:node`, and starts the Node host with test-only env values (placeholder secrets, `DATABASE_PATH=.e2e/540news.db`, `MEDIA_DIR=.e2e/media`). A `setup` project seeds labeled test data through the app; `phone-chromium`, `phone-webkit`, `tablet`, and `desktop` projects depend on it. Use `workers: 1` and `fullyParallel: false`.

## 6. Provisioning (owner approval required)

Prerequisites: the owner's Cloudflare account, and the `540news.com` zone in that account for the custom domain. The resource names below are intended names; check that they are free first.

```bash
npx wrangler login
```

```bash
npx wrangler d1 create 540news-site-db
```

Copy the printed `database_id` into `wrangler.jsonc`.

```bash
npx wrangler r2 bucket create 540news-site-media
```

R2 may require a payment method on file before it can be enabled. Keep the bucket private: do not enable a public `r2.dev` URL or a public custom domain on it.

Set secrets on the new Worker (each command prompts for the value):

```bash
npx wrangler secret put BETTER_AUTH_SECRET --name 540news-site
```

Repeat for `OWNER_EMAIL`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET`. Generate the auth secret with `openssl rand -base64 32`. List secret names (not values) with `npx wrangler secret list --name 540news-site`.

Create a **new** Google OAuth client (type Web application):

- Origins: `https://540news.com` and, for local dev, `http://localhost:5173`.
- Redirect URIs: `https://540news.com/api/auth/callback/google` and `http://localhost:5173/api/auth/callback/google`.

## 7. Configuration template

```jsonc
// hosting/cloudflare/wrangler.jsonc
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "540news-site",                       // must match the Worker name used by Workers Builds
  "main": "./worker.ts",
  "compatibility_date": "<SCAFFOLD_DATE>",      // the date the project is scaffolded (YYYY-MM-DD)
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true },
  "routes": [{ "pattern": "540news.com", "custom_domain": true }],
  "vars": { "PUBLIC_BASE_URL": "https://540news.com" },
  // Secrets (wrangler secret put <NAME> --name 540news-site):
  //   OWNER_EMAIL, BETTER_AUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "540news-site-db",
      "database_id": "<D1_DATABASE_ID>",
      "migrations_dir": "../../db/migrations"
    }
  ],
  "r2_buckets": [{ "binding": "MEDIA", "bucket_name": "540news-site-media" }]
}
```

The earlier app's config had no `assets` block; the Cloudflare Vite plugin appeared to add asset settings to the build output. Verify static assets are served after the first `npm run build` and deploy.

| Name | Kind | Notes |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | var | `https://540news.com`, no trailing slash |
| `OWNER_EMAIL` | secret | Keeps the owner's email out of the repo |
| `BETTER_AUTH_SECRET` | secret | ≥ 32 characters |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | secret | |
| `CLIENT_IP_HEADER` | var, optional | Default `cf-connecting-ip` on Workers |
| `RATE_LIMIT_*` | var, optional | Override the default agent limits |

## 8. CI/CD

**Deploys (proven):** Cloudflare Workers Builds, connected to the GitHub repo in the dashboard.

| Tab | Field | Value |
| --- | --- | --- |
| Production | Branch | `main` |
| Production | Build command | `npm run build` |
| Production | Deploy command | `npm run deploy:ci` |
| Previews | Builds for preview branches | On |
| Previews | Build command | `npm run build` |
| Previews | Preview command | `echo "Build-only check: previews are not deployed"` |

- `deploy:ci` applies pending D1 migrations to production, **then** deploys. If a migration fails, the deploy stops and the old version keeps running.
- The build API token needs **D1: Edit** as well as Workers permissions.
- Preview branches only build. Wrangler refuses a preview upload without a `previews` block naming preview-only resources, and Google OAuth does not accept wildcard redirect URIs. To enable previews later, add a `previews` block with a separate D1 database and R2 bucket.

**Tests before deploy (required by the requirements; the earlier app had none):** add a GitHub Actions workflow that runs `npm ci` and `npm run check` (and `npm run test:e2e` if run time allows) on pull requests and on `main`. Protect `main` so a pull request can merge only after the checks pass.

## 9. First deploy

1. Provision resources and secrets (section 6) and fill `<D1_DATABASE_ID>`.
2. Apply migrations and deploy from the owner's machine:

```bash
npm run db:migrate:remote
```

```bash
npm run deploy
```

3. Check health:

```bash
curl https://540news.com/health
```

Expect `{"ok":true,"host":"cloudflare","checks":{"database":"ok","media":"ok"}}`.

4. Connect the repo under **Workers & Pages → 540news-site → Settings → Build** with the table in section 8.
5. Run the deployment checklist (A17): owner Google sign-in, an invitation and reader sign-in, MCP connection and consent at `https://540news.com/mcp`, an agent API-key publish, an attachment upload, and unpublish/restore visibility. Record each as run or pending.

The custom-domain route creates DNS and a certificate on first deploy; the `540news.com` zone must be in the same Cloudflare account.

## 10. Operations

- **After any merged pull request that adds a migration**, confirm production is current (read-only), from an up-to-date `main` checkout. Wrangler compares against local files, so a stale checkout reports a false "nothing to apply".

```bash
npx wrangler d1 migrations list 540news-site-db --remote -c hosting/cloudflare/wrangler.jsonc
```

  Expect "No migrations to apply". Cross-check what production applied:

```bash
npx wrangler d1 execute 540news-site-db --remote -c hosting/cloudflare/wrangler.jsonc --command "SELECT name FROM d1_migrations ORDER BY id"
```

  The earlier app had two production incidents where migrations were silently skipped and signed-in pages failed. Keep this check.

- Live logs: `npx wrangler tail 540news-site --format json`.

## 11. Known constraints

| Constraint | Impact | Handling |
| --- | --- | --- |
| **Workers CPU time.** The free plan allows about 10 ms of CPU per request (waiting on the network or D1 does not count). | Markdown rendering, file signature checks, and search may exceed the free limit. | Confirm the owner's Cloudflare plan before production. Performance testing is deferred. |
| **`atomic()` statements cannot read each other's results** (D1 batch). | Shapes every multi-step write. | Read first, then conditional batch writes. See [DATA_AND_STORAGE.md](DATA_AND_STORAGE.md) section 2. |
| **A Worker cannot fetch its own hostname.** | JWT verification cannot call the app's own JWKS URL. | Verify in-process with `auth.api.getJwks()`. |
| **`wrangler d1 export` fails with FTS5 tables.** | No one-command database dump. | Backups are deferred; D1 Time Travel remains available. |
| **Better Auth details** (refresh-token lifetimes, built-in rate limits) were not documented in the earlier app. | Unknown defaults. | Check the Better Auth docs for the version in use and record the values. |
| **Google OAuth has no wildcard redirects.** | No preview deployments with sign-in. | Previews build only (section 8). |
| **MCP SDK results** pass `authInfo.token` as `""` and `scopes` as `[]`. | Tools cannot use OAuth scopes. | Authorization comes from the member's role and the agent guardrails, not scopes. |
