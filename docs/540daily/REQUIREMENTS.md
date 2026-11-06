# 540 Daily — Build Requirements

Status: Ready for implementation handoff. No application has been built or deployed during discovery.
Date: 2026-11-05

## 1. Purpose and document authority

540 Daily is a public news and research dashboard populated by external AI agents and human editors. Readers scan category panels, drill into stories and reports, search the archive, and optionally sign in to personalize their dashboard.

- Product: **540 Daily**
- Project: **540daily-site**
- Production origin: **https://540daily.com**
- Hosting: the owner's existing Cloudflare account, with a separate application, databases, and attachment storage.

**Confirmed** means selected by the owner during discovery. **Default** means a recommended implementation choice made under the owner's instruction to finish with defaults. Defaults are part of the implementation baseline unless changed; they are not claims of individual owner approval or technical verification.

This document takes precedence over the technical design documents listed in section 10. The [decision record](DECISIONS.md) preserves the conversation; this document resolves its earlier open items. Start implementation with [BUILD_PROMPT.md](BUILD_PROMPT.md).

## 2. Launch scope — confirmed

- Public reading without authentication.
- Invitation-only reader accounts using Google sign-in, with preferences saved across devices.
- Shared public dashboard and personal dashboards, organized into category panels.
- Panels show recent headlines and short summaries, with drill-down to category listings and full publications.
- Readers choose and reorder personal category panels. Editors choose and order public homepage categories.
- Light and dark themes.
- Stories and longer research reports, including daily briefings published as reports.
- Markdown authoring with image and chart attachments uploaded to 540 Daily.
- External agents publish automatically through both MCP and HTTP API. No editorial approval queue.
- Each publication supplies a category; new categories are created automatically. New categories do not automatically appear on the public homepage.
- Agents act on behalf of the signed-in member who connected them, and create and update only that member's publications. Editors can create and edit publications directly, with Markdown preview.
- Editor-only version history and restoration. Editors can unpublish and restore content, without permanent deletion at launch.
- Source links are optional.
- Duplicate-retry protection using an agent-supplied unique publication ID, without similar-story detection.
- Indefinite publication retention, keyword search, and category/date/publication-type filters.
- Private bookmarks synced across devices.
- Only the owner manages invitations and editor access.

## 3. Deferred and excluded from launch

**Confirmed:** Built-in research and publishing jobs are a later phase. External agents are developed outside this app. Daily briefings are read on the site, without email delivery. No learned personalization, AI question answering, similar-story detection, panel resizing, or standalone interactive dashboard widgets are required.

**Defaults:** No reading-history tracking, comments, reactions, push notifications, billing, native mobile application, automatic fact checking, source scraping, or in-app AI calls. No email invitation service is required. Charts are uploaded static images, not executable embeds. No research scheduler, AI API key, or paid AI subscription is a launch dependency.

**Deferred by the owner (2026-11-06):** app-level backup export and restore, and performance (CPU) testing, are not part of launch.

## 4. Roles and access

The distinctions below implement the confirmed public/reader/editor/owner model.

**Confirmed by the owner (2026-11-06): agents act as the member who connected them.** Google sign-in decides everything: a member connects an MCP client by signing in with Google, or creates an API key on their account, and the agent then acts as that member with that member's role. There is no separate agent identity and no owner approval step per agent. Two guardrails apply to every agent call: agent interfaces only create publications and update the connecting member's own publications, and they offer no unpublish, restore, delete, layout, or access-management operations.

| Capability | Visitor | Invited reader | Editor | Owner | Agent (acting as a member) |
| --- | --- | --- | --- | --- | --- |
| Read/search published content | Yes | Yes | Yes | Yes | Yes |
| Personal dashboard/bookmarks | No | Own | Own | Own | No |
| Create publications | No | No | Yes | Yes | Only if the member is an editor or owner |
| Update publications | No | No | Any | Any | The member's own publications only |
| View history/restore revisions | No | No | Yes | Yes | No |
| Unpublish/restore public visibility | No | No | Yes | Yes | No |
| Configure public category panels | No | No | Yes | Yes | No |
| Invite users/change roles/revoke access | No | No | No | Yes | No |
| Connect MCP clients (read-only for readers) | No | Own | Own | Own | No |
| Create/revoke API keys | No | No | Own | Own and any member's (revoke) | No |

Defaults:

- Bootstrap one owner from server configuration `OWNER_EMAIL`; match a verified Google identity. Never allow public role selection or self-promotion.
- Owner adds an exact email address as a reader invitation and can copy the sign-in URL to share manually. Match the verified Google email, normalized for case, without Gmail-specific alias rewriting. Google sign-in alone does not create an account for an uninvited visitor.
- Owner can promote an accepted reader to editor, demote an editor, revoke an invitation, or disable an account. Prevent removal of the sole owner through normal role controls.
- Re-check account status and role for protected requests. Disabling an account invalidates sessions; revoking an unaccepted invitation prevents registration. Disabling a reader does not change public access to news.
- Protect all writes on the server. Enforce same-origin/CSRF protection for cookie-authenticated writes. Reader preferences and bookmarks require ownership checks.
- Use the MCP OAuth flow in [MCP_AND_AUTH.md](MCP_AND_AUTH.md). Any active member may approve a connection for their own account on `/consent`. API keys belong to one member, work with both MCP and HTTP, and act as that member. Hash API keys, show secrets only at creation, and never log tokens.
- Members see and revoke their own MCP connections and API keys on `/account`. The owner can see and revoke any member's connections and keys on `/owner`.
- Every agent call re-checks the member's status and current role, and whether the key or connection is revoked. Disabling a member, demoting an editor to reader, revoking a key, or disconnecting a client stops writes immediately.
- Publications created through an agent record the member and the client or key label, and display as "<member> via <client>". Editor changes do not change the original creator.

## 5. Screens and reader journeys

Routes below and display limits are defaults; the dashboard/drill-down behavior is confirmed.

| Route | Experience |
| --- | --- |
| `/` | Public category dashboard configured by editors |
| `/categories` | Directory of categories containing published content, including those absent from the homepage |
| `/categories/:slug` | Category publications, newest first, with type filter and pagination |
| `/publications/:id/:slug?` | Story/report detail with headline, summary, Markdown body, attachments, category, dates, author/agent attribution, and optional sources |
| `/search` | Keyword search with category, publication type, and date range |
| `/dashboard` | Signed-in personal category dashboard and explicit-interest filters |
| `/saved` | Current published versions of the reader's bookmarks |
| `/sign-in`, `/consent` | Google sign-in and agent OAuth consent |
| `/editor` | Publication list, create/edit, preview, history, restore, unpublish; homepage category configuration |
| `/account` | The signed-in member's MCP connections and API keys (keys for editors and owner only) |
| `/owner` | Invitations, roles, account status, all members' MCP connections and API keys, recent publishing failures |

Default experience:

- Responsive category grid: one column on narrow screens and two or three as space permits. Make reading, bookmarking, category configuration, and editorial controls usable on phones.
- Five newest publications per panel; headline plus up to 240 characters of summary, date, and publication-type label. No invented sample stories in production.
- Use original app publication time for recency; an edit does not move an old story to the top. Show updated time separately.
- Category/search pages show 20 results per page, with stable ordering using timestamp and ID.
- A first-time personal dashboard starts from the current public layout. Later public layout changes do not overwrite personal settings. New categories become available in the selector, without automatic insertion.
- Preserve the earlier explicit-interest requirement using optional agent/editor-supplied tags for topics, teams, people, and companies. Readers can select known tags to filter their personal dashboard. Selected categories use OR matching; if tags are selected, match any selected tag within those categories. Do not infer interests or require agents to submit tags.
- Related publications: up to five published items from the same category, excluding the current item, newest first. No AI similarity feature.
- Theme defaults to the device preference. Save explicit choices to signed-in accounts; anonymous visitors may save theme locally. Anonymous theme switching is not a content-edit permission.
- Keyboard-operable controls, visible focus, accessible names, image alt text, readable contrast in both themes, and reduced-motion support. Provide move-up/down buttons as well as any drag interaction.
- Show honest empty, loading, unavailable, and error states. A failed save keeps the user's unsaved input and offers retry.

## 6. Publications and editorial behavior

Field limits and metadata choices are defaults. Enforce the same schema for editors, MCP, and HTTP.

| Field | Requirement |
| --- | --- |
| `externalId` | Required for agent creation; 1–128 characters, unique per member (across all of that member's connections and keys) |
| `type` | Required: `story` or `report`; a briefing is a report with optional `briefing` tag |
| `title` | Required; 1–200 characters |
| `summary` | Required; 1–1,000 characters; plain text |
| `bodyMarkdown` | Required for reports, optional for short stories; at most 100,000 characters |
| `category` | Required display name, 1–80 characters; one category per publication |
| `tags` | Optional, up to 20 tags, each at most 60 characters |
| `sources` | Optional, up to 20 HTTP(S) links with optional labels; do not fetch them automatically |
| `attachmentIds` | Optional, up to 20 authorized uploaded assets referenced by the Markdown |
| `sourcePublishedAt` | Optional source date; separate from app publication time |
| Server fields | ID, creator member and client/key label, status, revision number, created/published/updated timestamps, change actor |

Defaults:

- Normalize category/tag names with Unicode normalization, trimming, collapsed whitespace, and case-insensitive uniqueness. Preserve a readable display label; generate stable collision-safe slugs.
- Seed Technology, Business, Finance, Sports, and Entertainment once. Initially select them for the public layout; show an empty state until real publications arrive. Editors can change selection and order. Categories are flat at launch.
- Store submitted text, not fetched full-text copies of linked sources. Render source links when provided; do not fabricate sources or imply independent verification.
- Submitted Markdown is untrusted. Sanitize output, disable raw HTML/scripts/iframes, validate link protocols, and allow inline images only through valid app attachment references. Ordinary external source links remain supported.
- Display creator attribution from trusted account metadata, including the client or key label for agent-created items. Editor changes do not change the original creator.
- Agent creations publish immediately after successful validation. Editor authoring supports private drafts, preview, and an explicit Publish action. Saving edits to an already-published item updates the public version immediately.
- Use an expected revision number for updates, including editor saves. Reject stale updates with a conflict instead of losing changes.
- Keep revisions indefinitely by default. Each successful content/status change appends an immutable snapshot with actor and time. Restoring a revision creates a new revision and does not erase history.
- Revision restoration preserves current visibility. Unpublishing and restoring visibility are separate editor actions. An agent updating its own unpublished item cannot republish it.
- Unpublished items and private drafts are excluded from public detail, search, related results, category counts, and feeds. Bookmarks may show a generic unavailable entry without leaking the title or content.
- No permanent deletion UI. Retention refers to app data, not a guarantee of a cloud provider's backup duration.

## 7. Search and persistence

Defaults:

- Use D1 with Drizzle and migrations, plus FTS5 over current published title, summary, and body text.
- Public search never returns draft/unpublished content or historical revisions. Keep index updates consistent with content/status changes.
- Keyword search defaults to relevance, then newest; browsing without a query defaults to newest. Filters combine with AND.
- Date filters use app publication date, with inclusive calendar dates in America/Chicago. Store UTC timestamps; return ISO 8601 dates in integrations. Explain the date basis in the UI.
- Bookmarks are unique per user/publication and resolve to the current version, not snapshots.

Logical entities (defaults; the agent may refine physical tables without changing behavior):

| Entity | Essential data |
| --- | --- |
| Auth and membership | Kit auth tables, user role/status, invitations, owner configuration |
| Agent credentials | Member-owned API keys (hashed, label, revoked time); MCP connection revocations |
| Category/tag | ID, display name, normalized unique name, slug |
| Publication | Fields in section 6, creator identity, visibility, revision, timestamps |
| Publication revision | Immutable content/status snapshot, actor, time, revision number |
| Attachment | R2 key, MIME type, size, digest, alt text, uploader identity, lifecycle state |
| Attachment references | Links to publication versions, retaining assets needed by historical revisions |
| Preferences | User category ordering/visibility, selected tags, theme |
| Homepage configuration | Editor-managed category order/visibility |
| Bookmark | User/publication composite uniqueness and saved time |
| Submission receipt | Member ID and external ID, canonical create-payload hash, publication ID |
| Audit event | Account/role/credential and publishing actions; no secrets or full request bodies |

Use database uniqueness for category normalization and `(user_id, external_id)`. Duplicate creation must be atomic with its receipt/publication; a failed attempt must not leave a receipt claiming success. Use conditional writes and D1 batch patterns for concurrent updates.

## 8. Attachments

App-managed uploads are confirmed. The following are defaults:

- Dedicated private R2 bucket, served through access-checked app routes; no public bucket URL that bypasses publication visibility.
- Accept PNG, JPEG, and WebP, up to 10 MiB per attachment. Charts are rendered images. Reject SVG, HTML, scripts, and other file types at launch. Verify content signatures, not just extensions, and require alt text.
- Upload before publication; return an attachment ID and document the Markdown reference syntax, such as `![description](attachment:ID)`.
- Agents can attach only assets uploaded by the same member; editors can manage assets for publications they edit. Prevent asset reuse across members from bypassing visibility or ownership.
- An asset is publicly readable only while referenced by a current published version. Assets used only by older revisions or unpublished content are editor-only. Access-check before serving; do not publicly cache protected media or responses in a way that survives unpublishing.
- Retain all referenced assets indefinitely. Owner may run explicit cleanup of unreferenced uploads older than seven days; no scheduled cleanup service is required at launch.
- For large binary transfer, provide an authenticated upload operation; MCP may return a short-lived, single-use upload ticket for the same-origin HTTP upload endpoint. Bind tickets to the member, MIME type, and size limit. Agents must not need an external public image host.

## 9. Agent integration contract

Both interfaces and ownership restrictions are confirmed. Names and details below are defaults to implement and document.

| Operation | MCP tool | HTTP API |
| --- | --- | --- |
| List categories | `list_categories` | `GET /api/v1/categories` |
| Search published items | `search_publications` | `GET /api/v1/publications` |
| Read publication | `get_publication` | `GET /api/v1/publications/:id` |
| Create publication | `create_publication` | `POST /api/v1/publications` |
| Update own publication | `update_publication` | `PATCH /api/v1/publications/:id` |
| Initiate attachment upload | `prepare_attachment_upload` | `POST /api/v1/attachment-uploads` |

- MCP endpoint is `/mcp`; follow the OAuth discovery and consent patterns in [MCP_AND_AUTH.md](MCP_AND_AUTH.md), with the access rules in section 4.
- Document binary upload completion and asset status lookup. HTTP creation accepts JSON; upload uses binary transfer separately.
- Agent APIs require credentials even for integration reads. The public website remains anonymously readable through its own routes.
- Agent get/list operations can expose the member's own unpublished items for correction; never expose another member's private items or revision history. Public reads expose only published content.
- Return canonical publication IDs, revision numbers, URLs, and structured validation errors. Keep MCP structured results and HTTP data shapes consistent.
- Retried identical creation with the same member and external ID returns the original receipt/publication ID and current revision without writing again, even across MCP and HTTP. A different canonical create payload under that ID returns conflict. Use explicit update for changes.
- Update requires `expectedRevision`. No implicit upsert and no agent unpublish, restore, delete, category-layout, or role-management operations.
- Suggested HTTP outcomes: 201 new creation, 200 read/update/replay, 400 malformed request, 401 missing/invalid credential, 403 forbidden operation, 404 unavailable item, 409 duplicate-payload or revision conflict, 413 oversize, 422 field validation, 429 rate limit, 503 unavailable dependency. Do not leak private item existence through public errors.
- Default authenticated limits: 60 metadata/API requests per minute per member, including at most 10 writes and 5 upload initiations per minute. Enforce across Worker instances with shared storage; configurable server settings, `Retry-After` on 429. Do not claim these values are Cloudflare service limits.
- Log operation ID, member ID, credential ID, status, and timing without credentials. Failed publication leaves no publicly visible partial record. Return retryable errors clearly.

Example creation payload (illustrative, not production content):

```json
{
  "externalId": "example-report-001",
  "type": "report",
  "title": "Example research briefing",
  "summary": "An example summary supplied by an external agent.",
  "bodyMarkdown": "## Overview\nExample report text.",
  "category": "Technology",
  "tags": ["briefing"],
  "sources": [],
  "attachmentIds": []
}
```

## 10. Technical foundation and intentional differences

The technical design, adapted from an earlier production app built on the same stack, is in: [STACK.md](STACK.md), [ARCHITECTURE.md](ARCHITECTURE.md), [MCP_AND_AUTH.md](MCP_AND_AUTH.md), [DATA_AND_STORAGE.md](DATA_AND_STORAGE.md), [IMPLEMENTATION_PATTERNS.md](IMPLEMENTATION_PATTERNS.md), and [DEVELOPMENT_AND_DEPLOYMENT.md](DEVELOPMENT_AND_DEPLOYMENT.md).

Defaults:

- Preserve one Cloudflare Worker/origin for React Router SSR, OAuth, MCP, HTTP API, and media routes; TypeScript, Drizzle/D1, R2, isolated core services, thin adapters, per-request Worker services, environment configuration, and additive migrations.
- Resource names: Worker `540daily-site`, D1 `540daily-site-db`, R2 `540daily-site-media`. These are intended names, not provisioned resources; check availability in the owner's account. Bind DB and MEDIA to new resources only.
- Choose dependency versions for this project at build time: current stable releases that work together, pinned exactly and recorded in STACK.md. Do not copy versions from the earlier app. Never silently invent packages, versions, SDK methods, or successful tests.
- Use invitation-based reader/editor/owner membership, bootstrapped from `OWNER_EMAIL`. Do not treat all signed-in users as admins.
- Include search and media storage as required launch features. Do not set a blanket `noindex` header: published pages should be indexable; private/editor/auth pages should not. Generate a sitemap containing only published public URLs.
- No in-app AI calls, AI SDK, or AI API key at launch. Keep the architecture open to later AI services (behind a core interface) without adding unused paid dependencies to the launch path.
- Add CI checks before deployment. Provide `/health` with minimal dependency health and no secrets. Keep an owner-visible recent publishing-failure view backed by bounded operational logs (30-day default retention).
- No cost estimate or hosting plan is assumed. No application-triggered AI spending at launch. Record storage/traffic usage guidance and confirm the owner's Cloudflare plan before production deployment.

## 11. Acceptance criteria

Use automated tests for authorization, data consistency, integration behavior, and key browser journeys. Distinguish mocked, local, and live verification.

| ID | Passing behavior |
| --- | --- |
| A1 | Anonymous visitors read homepage, category, search, and published details; protected writes fail without authentication. |
| A2 | Invited verified Google identities gain intended membership; uninvited identities cannot register; only owner can invite or change roles. |
| A3 | Reader A cannot read/change reader B's preferences or bookmarks; editor cannot manage invitations or another member's API keys or connections. |
| A4 | Each authenticated interface creates and reads back a story/report. A new category is persisted but is absent from the public layout until selected by an editor. |
| A5 | Repeated and concurrent identical creates, including one over MCP and one over HTTP, produce one publication. Changed payload under the same external ID returns conflict. |
| A6 | An agent acting as member A cannot update member B's content. A's new key or reconnected client can still update A's items. Revoked keys and disconnected clients fail. Agents acting as readers, or as a disabled or demoted member, cannot write. |
| A7 | Conflicting expected revisions fail without lost changes. Editor history records actor/time; restoration appends a new revision. |
| A8 | Unpublishing removes content from every public surface and blocks attachment access as appropriate. Agent updates cannot republish it. Editor restoration returns it to public view. |
| A9 | Personal category selection/order, explicit-interest filters, theme, and bookmarks persist across sessions/devices without changing public layout. |
| A10 | Keyword search finds title, summary, and body matches and applies category/type/date filters. Old publications remain searchable; unpublished revisions never appear. |
| A11 | Markdown preview and detail rendering are safe against script/link injection. Invalid, oversized, or unauthorized attachments are rejected. Historical revisions retain required assets. |
| A12 | Desktop and narrow mobile layouts work in both themes. Keyboard users can navigate, reorder panels, bookmark, and edit; empty/error states are usable. |
| A13 | MCP discovery, OAuth consent/token flow, initialization, tool listing, and tool calls pass integration tests. Both interfaces share validation and return documented failures. |
| A14 | Editor creation, publication, editing, unpublish, history, restore, and homepage configuration work end to end. |
| A15 | Migrations run on a fresh local database; type checking, lint, unit/integration tests, production build, and critical browser tests pass. No runtime research AI key is required. |
| A16 | Removed: backup export and restore are deferred (section 3). ID kept so other IDs stay stable. |
| A17 | Production configuration points only to dedicated 540 Daily resources. A deployment checklist records real domain, Google login, MCP connection, upload, and visibility checks as run or pending. |

## 12. Delivery and deployment inputs

The build agent must deliver working application code, migrations, tests, local setup instructions, safe environment examples, API/MCP documentation with examples, and a verification report. Keep setup credentials out of committed files.

Remaining inputs are operational, not unanswered product requirements:

- Cloudflare account access and actual new resource IDs.
- Verified control/DNS configuration for `540daily.com`.
- Owner's Google email supplied through configuration.
- Dedicated Google OAuth client and redirect configuration.
- Authentication secret, and API keys created by members after launch.
- Cloudflare plan/cost choice and production deployment authorization.

Proceed with local implementation using placeholders and test identities. Do not guess credentials or claim ownership, provisioning, deployment, or live verification. Request missing operational inputs only when needed. This document is a handoff specification, not an instruction to deploy during requirements gathering.
