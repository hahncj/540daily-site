# Deployment

## Hosting model

Everything ships as **one Cloudflare Worker** on a custom domain:

| Piece | Where it runs in production |
| --- | --- |
| Frontend (SSR pages + client JS/CSS) | Worker (SSR) + static assets. `wrangler.jsonc` has no `assets` block; **inferred**: the Cloudflare Vite plugin adds the asset config to its build output. Verify after the first build (G11) |
| MCP server `/mcp` | Same Worker |
| OAuth server `/api/auth/*`, `/.well-known/*` | Same Worker (Better Auth) |
| Backend logic, HTTP API | Same Worker |
| Claude calls | From the Worker to the Anthropic API; key is a Worker secret |
| Database | D1, bound as `DB` |
| Files | R2, bound as `MEDIA` (optional) |

Same origin for all of these is required: the MCP resource URL, OAuth issuer, and Google redirect URI are all derived from `PUBLIC_BASE_URL`.

## Build artifacts

- `npm run build` → `react-router build` with the Cloudflare plugin → Worker bundle + `build/client` assets. `wrangler deploy` uploads them using `hosting/cloudflare/wrangler.jsonc`.
- `npm run build:node` (optional) → `build/server/index.js` (exports `createNodeApp`) + `build/client`.
- Docker (optional): `hosting/node/Dockerfile`, two-stage `node:24-slim`; volume `/data` for SQLite and files; applies migrations on start.

## CI/CD (confirmed from source docs; configured in the Cloudflare dashboard, no repo workflow files)

Cloudflare **Workers Builds** connected to the GitHub repo:

| Tab | Field | Value |
| --- | --- | --- |
| Production | Production branch | `main` |
| Production | Build command | `npm run build` |
| Production | Deploy command | `npm run deploy:ci` |
| Previews | Builds for preview branches | On |
| Previews | Build command | `npm run build` |
| Previews | Preview command | `echo "Build-only check: previews are not deployed"` |

- `deploy:ci` applies pending D1 migrations to the remote database **then** deploys. A failed migration stops the deploy; the old version keeps running.
- The build API token needs **D1: Edit** in addition to Workers permissions.
- Preview branches build only. Reason given in source docs: Wrangler refuses a preview upload without a `previews` block naming preview-only resources, and Google OAuth does not accept wildcard redirect URIs. To enable previews later, add a `previews` block with a separate D1 database and R2 bucket.
- **No tests run in CI** (confirmed: no GitHub Actions or other CI files). Tests run locally before opening a PR. See DECISIONS_AND_GAPS.md G7.

## First deploy for the new app

1. Provision resources and secrets (see [DATABASE_AND_CLOUD.md](DATABASE_AND_CLOUD.md) section 10).
2. Fill `wrangler.jsonc` placeholders.
3. Apply migrations and deploy from your machine:

```bash
npm run db:migrate:remote
```

```bash
npm run deploy
```

4. Check health:

```bash
curl https://<APP_DOMAIN>/health
```

Expect `{"ok":true,"host":"cloudflare","checks":{"database":"ok",...}}`.

5. Connect the repo in **Workers & Pages → `<WORKER_NAME>` → Settings → Build** with the table above.
6. Add the MCP connector: `https://<APP_DOMAIN>/mcp`.

The custom-domain route creates DNS and a certificate on first deploy; the parent zone must be in the same Cloudflare account.

## Environment configuration

| Name | Kind | Notes |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | `vars` in `wrangler.jsonc` | `https://<APP_DOMAIN>`, no trailing slash |
| `ADMIN_EMAILS` | secret | Kept secret so emails stay out of a public repo |
| `BETTER_AUTH_SECRET` | secret | ≥ 32 chars |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | secret | |
| `ANTHROPIC_API_KEY` | secret, optional | AI off without it |
| `ANTHROPIC_MODEL` | var, optional | |
| `ANTHROPIC_BASE_URL` | var, optional | Leave unset in production |
| `CLIENT_IP_HEADER` | var, optional | Default `cf-connecting-ip` on Workers |

## Operations

- **After every merged PR that adds a migration**, confirm production is up to date (read-only), from an up-to-date `main` checkout (Wrangler compares against local files, so a stale checkout gives a false "nothing to apply"):

```bash
npx wrangler d1 migrations list <D1_DATABASE_NAME> --remote -c hosting/cloudflare/wrangler.jsonc
```

  Expected: "No migrations to apply". Cross-check what production applied:

```bash
npx wrangler d1 execute <D1_DATABASE_NAME> --remote -c hosting/cloudflare/wrangler.jsonc --command "SELECT name FROM d1_migrations ORDER BY id"
```

  The source app's guide records two production incidents where migrations were silently skipped and signed-in pages failed. Keep this check.
- Live logs: `npx wrangler tail <WORKER_NAME> --format json`.
- CPU budget: Workers free plan allows about 10 ms CPU per request (network and DB waits do not count). Check **Workers & Pages → Metrics → CPU time** after deploy.
- Backups: D1 Time Travel (`npx wrangler d1 time-travel info <D1_DATABASE_NAME>`); `wrangler d1 export` fails if the DB has FTS5 virtual tables.
- Commands that change production (remote migrations, `wrangler secret put`, `wrangler deploy`) should be confirmed by the owner first, and always pass `--name <WORKER_NAME>` or `-c hosting/cloudflare/wrangler.jsonc`.

## Settings tied to the source app (replace all)

Worker name, custom domain, `PUBLIC_BASE_URL`, D1 name and ID, R2 bucket name, every secret, the Google OAuth client and its redirect URIs, the Anthropic key, the Workers Builds repo connection and API token, the MCP server name and instructions, and the site's brand assets. Full table: [DATABASE_AND_CLOUD.md](DATABASE_AND_CLOUD.md) section 12.
