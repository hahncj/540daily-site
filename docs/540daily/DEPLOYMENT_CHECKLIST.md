# Deployment checklist (A17)

Use this for the first launch check and after any risky change. Mark each line **Run** (with date and who) or **Pending**. Sections 1, 2, and 6 only read. Sections 3–5 sign in, invite, publish, upload, and unpublish on production, so the owner runs them by hand (or explicitly approves each one), using clearly labeled test data.

Status as of 2026-11-11 (Stage 4). "Run" below means checked on the live site; anything not listed as run is pending.

## 1. Production points only at 540 Daily's own resources

| Check | How | Status |
| --- | --- | --- |
| Worker is `540daily-site` | `hosting/cloudflare/wrangler.jsonc` `name` | Run (config read, 2026-11-11) |
| D1 binding `DB` → `540daily-site-db` | `wrangler.jsonc` `d1_databases` | Run (config read, 2026-11-11) |
| R2 binding `MEDIA` → `540daily-site-media`, private (no `r2.dev` URL, no public domain) | `wrangler.jsonc`; Cloudflare dashboard → R2 → bucket → Settings | Config read 2026-11-11; **dashboard check pending (owner)** |
| No binding to the owner's other site | Compare names in `wrangler.jsonc` with the other site's | Run (config read, 2026-11-11) |
| Secrets set: `OWNER_EMAIL`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `npx wrangler secret list --name 540daily-site` (names only) | **Pending (owner)** |
| `PUBLIC_BASE_URL` is `https://540daily.com` | `wrangler.jsonc` `vars` | Run (config read, 2026-11-11) |

## 2. Domain and basics

| Check | Expected | Status |
| --- | --- | --- |
| `https://540daily.com/health` | `{"ok":true,"host":"cloudflare","checks":{"database":"ok","media":"ok"}}` | Run (2026-11-11, read-only curl) |
| `https://www.540daily.com/` and `http://540daily.com/` | 301 to `https://540daily.com/` | Run (2026-11-11) |
| Homepage loads | 200 | Run (2026-11-11) |
| `robots.txt` lists the sitemap; public pages have no `noindex` | `Sitemap: https://540daily.com/sitemap.xml` | Run (2026-11-11, robots only) |
| Database migrations are current | `npx wrangler d1 migrations list 540daily-site-db --remote -c hosting/cloudflare/wrangler.jsonc` says nothing to apply | **Pending (owner)** |

## 3. Google sign-in and membership

| Check | Steps | Status |
| --- | --- | --- |
| Owner signs in | Open `/sign-in`, sign in with the `OWNER_EMAIL` Google account. The header shows **Owner** | **Pending (owner)** |
| Uninvited Google account is refused | In a private window, sign in with a Google account that was not invited. Expect a refusal, no account | **Pending (owner)** |
| Invite and accept | On `/owner`, invite a second Google address, copy the sign-in link, sign in with that account in a private window. It appears as an active reader | **Pending (owner)** |
| Role change | Make that reader an editor; the **Editor** link appears after reload. Make them a reader again | **Pending (owner)** |
| Disable | Disable them; their open session is signed out. Enable again | **Pending (owner)** |

## 4. Agents

| Check | Steps | Status |
| --- | --- | --- |
| MCP discovery | `https://540daily.com/.well-known/oauth-protected-resource/mcp` returns `resource: https://540daily.com/mcp` | Run (2026-11-11) |
| Unauthenticated calls refused | `POST /mcp` and `GET /api/v1/categories` without a token return 401 | Run (2026-11-11) |
| MCP connection with Google | `claude mcp add --transport http 540daily https://540daily.com/mcp`, approve on `/consent`, then ask the client to call `list_categories` | **Pending (owner)** |
| API key publish | On `/account`, create a key. Publish a clearly labeled test story (see [API_AND_MCP_CONTRACT.md](API_AND_MCP_CONTRACT.md) section 6) to a test category such as "Launch Checks". Expect 201, then the same call again returns 200 `replayed` | **Pending (owner)** |
| Revoke | Revoke the key; the next call returns 401 | **Pending (owner)** |

## 5. Upload and visibility

| Check | Steps | Status |
| --- | --- | --- |
| Upload | Start an upload, `PUT` a small PNG, and use its Markdown in the test story. The image shows on the public page | **Pending (owner)** |
| Rejected file | `PUT` a text file to a fresh PNG ticket. Expect 422 | **Pending (owner)** |
| Unpublish | In `/editor`, unpublish the test story. Its page, search result, category entry, sitemap entry, and image URL all stop working for a signed-out visitor | **Pending (owner)** |
| Restore | **Restore to public view**; it returns with its original time | **Pending (owner)** |
| Clean up | Leave the test story unpublished afterwards (there is no delete at launch) | **Pending (owner)** |

## 6. Deploy pipeline

| Check | Expected | Status |
| --- | --- | --- |
| `main` is protected; the GitHub Actions `check` job must pass to merge | Repository settings → Branches | Reported set up before Stage 4; not re-verified |
| Workers Builds deploys `main` with `npm run deploy:ci` (migrations first) | Cloudflare dashboard → Workers & Pages → `540daily-site` → Settings → Build | Reported set up before Stage 4; not re-verified |
| The build token has **D1: Edit** | Cloudflare API token settings | **Pending (owner)** |
| Cloudflare plan confirmed (Workers CPU and D1 limits) | Free plan allows about 10 ms CPU per request, and D1 limits queries per request. A create with many tags and attachments, or saving a large homepage or dashboard layout, runs one statement per row in a batch. Check the current limits for the plan; not verified in Stage 4 | **Pending (owner)** |

## 7. A16

A16 (backup export and restore) was removed from launch scope on 2026-11-06. Nothing to check. D1 Time Travel is the recovery option.
