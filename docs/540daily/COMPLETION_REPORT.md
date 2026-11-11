# Completion report (Stage 4: hardening and acceptance)

Date: 2026-11-11. Branch: `feature/stage-4-hardening`. Stages 0–3 were already merged and deployed to `https://540daily.com`.

## 1. Summary

- All launch features in REQUIREMENTS.md are built. Stage 4 added tests, fixed three bugs those tests found, and wrote the contract, operating, and deployment docs.
- Acceptance checks A1–A15 pass locally. A16 was removed from scope. A17 is partly checked on the live site (read-only); the rest needs the owner (see [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md)).

## 2. Bugs found and fixed in Stage 4

| Bug | Who it hit | Fix | Test |
| --- | --- | --- | --- |
| **D1 refuses queries with more than 100 bound values.** Lists of IDs were bound one value each. Local tests use better-sqlite3, which allows thousands, so they passed. | Production only: the homepage once 20+ panels each show 5 items; dashboards with many panels plus interests; owner upload cleanup with 100+ old uploads; and long saved-item checks. | `inList()` in `server/adapters/in-list.ts` binds the whole list as one JSON value (`IN (SELECT value FROM json_each(?))`). Used for every ID list in the adapters. | `tests/server/d1-batch.test.ts`: 125-item homepage, 50 panels + 50 interests, cleanup of 120 uploads, on real D1 |
| **WebKit (Safari) hydration failure on story pages.** WebKit writes "Nov 6, 2026 at 9:00 AM"; Node writes "Nov 6, 2026, 9:00 AM". React saw different text, threw away the server HTML, and re-rendered. That also removed a visitor's saved theme on every story page. | Safari and iPhone/iPad visitors | `app/components/format.ts` builds the date and time text itself with plain spaces | `tests/e2e/hardening.spec.ts`: "pages hydrate without errors" (13 pages, all browsers) and the theme test |
| **Error pages had no `<title>`** (accessibility: WCAG 2.4.2) | Everyone on a 404 or error page | `app/root.tsx` now has a fallback `meta` that titles error pages | `hardening.spec.ts` not-found test (title and axe) |

The editor's time display (`app/components/editor/shared.tsx`) now uses the same date formatter, instead of hiding the WebKit mismatch with `suppressHydrationWarning`.

Earlier D1-only bugs (fixed in PR #11 before this stage): drizzle's batch crashed on raw `db.run(sql)` with parameters, and D1's `meta.changes` counts trigger-changed rows. Both stay covered by the D1 tests.

Other D1 differences checked and found fine: single-statement guards (`onConflictDoUpdate … setWhere … returning` in rate limits, ticket claiming, the sole-owner guard), constraint-error detection under concurrent creates, `notInArray` with a subquery in failure-log pruning, and 50-statement batches.

## 3. What ran

| Command | Result | Kind |
| --- | --- | --- |
| `npm run check` (typegen, `tsc`, ESLint, Vitest) | Passed: 21 files, 244 tests | Local |
| `npx vitest run tests/server/d1-batch.test.ts` | Passed: 15 tests on D1 in Miniflare (in memory) | Local, real D1 engine |
| Full Playwright suite, 4 projects (Pixel 7 Chromium, iPhone 15 WebKit, iPad WebKit, desktop Chrome) | Passed: 210 tests (final run, after all fixes) | Local, Node build |
| `wrangler d1 migrations apply --local` on an empty folder | Both migrations applied | Local |
| `npm run build` (Worker production build) | Passed | Local |
| `curl` read-only checks of `https://540daily.com` | `/health` ok (database and media); OAuth discovery correct; `/mcp` and `/api/v1/categories` return 401 without a token; `www` and `http://` redirect 301; robots lists the sitemap | **Live**, read-only |

## 4. Acceptance checks

"Local" = real code and real SQL on this Mac. "Faked" = what is replaced in that test.

| ID | Result | Where | Faked or not covered |
| --- | --- | --- | --- |
| A1 | Pass | `public-reading` (Vitest and Playwright), `app.test.ts` | — |
| A2 | Pass | `auth-gate`, `account-owner` (Vitest and Playwright), D1 test | Google's token signature check is replaced; Playwright writes sessions straight into SQLite |
| A3 | Pass | `access`, `account-owner`, `reader-features`, `reader.spec` | Same as A2 |
| A4 | Pass | `agent-interfaces` | — |
| A5 | Pass | `agent-interfaces`, `publications`, D1 test (concurrent MCP + HTTP on D1) | — |
| A6 | Pass | `agent-interfaces`, `account-owner`, D1 test | MCP OAuth runs in-process; no real MCP client app |
| A7 | Pass | `publications`, `editor` (Vitest and Playwright), D1 test | — |
| A8 | Pass | `publications`, `public-reading`, `editor`, D1 test | — |
| A9 | Pass | `reader-features`, `reader.spec` (second device = second browser context) | — |
| A10 | Pass | `search`, `public-reading`, D1 test (FTS5 on D1) | — |
| A11 | Pass | `markdown`, `attachments`, `editor.spec`, D1 test | Image bytes are tiny test images; R2 is a memory or file store locally |
| A12 | Pass | `hardening.spec` plus the axe checks in every spec, both themes, phone, tablet, desktop | Real phones not used (Playwright device emulation) |
| A13 | Pass | `agent-interfaces`, `consent.test` | In-process OAuth; no third-party MCP client |
| A14 | Pass | `editor.test`, `editor.spec` | — |
| A15 | Pass | `migrations.test`, fresh local migration, `npm run check`, build, Playwright | No AI key used anywhere |
| A16 | Removed | Backup export/restore deferred by the owner on 2026-11-06 | — |
| A17 | Partly run | [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) | Sign-in, MCP connection, key publish, upload, and visibility checks on the live site are **pending** |

## 5. Not run

- Real Google sign-in, real MCP client connection, real R2, and any write on production. These are the A17 owner steps.
- Workers runtime end to end: browser tests run on the Node build. The Worker build compiles, and D1 behavior is tested in Miniflare, but pages were not driven through `workerd` in this stage.
- Playwright is not part of GitHub Actions (`check` job runs Vitest, lint, and types only). Run `npm run test:e2e` locally before merging UI changes.
- Performance (CPU) testing and backups: deferred by the owner.

## 6. Deviations and known limits

- Owner lists show at most 1,000 rows; the bookmark cap (2,000) is checked before insert, so two saves at once could pass it by one.
- The sitemap lists the newest 1,000 publications.
- Not verified: whether D1's per-request query limit on the Free plan counts each statement in a batch. Saving a 50-panel layout, or a create with 20 tags and 20 attachments, runs one statement per row. Tested fine in Miniflare, which does not enforce plan limits.
- Workers free plan CPU (about 10 ms per request) may be too low for Markdown rendering and search. Confirm the plan.

## 7. Reviews

- An independent review subagent checked the docs and code changes against REQUIREMENTS.md. It found no code bugs; its doc corrections (upload completion and status examples, which failures use up an upload URL, MCP-level 401/429 shapes, two wrong labels, the checklist's read-only claim) are applied.
- `/code-review` on the branch diff found five items (duplicate error-page titles, the editor's separate date formatter, a test that could leave owners disabled after a failure, unfilled report placeholders, an unneeded export). All fixed.

## 8. Owner steps left (Stage 5)

Follow [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) sections 1–6 and mark each line. In short: confirm secrets and the private bucket in the dashboard, confirm migrations are current, then sign in, invite, connect an MCP client, publish with a key, upload an image, and unpublish/restore a labeled test story.
