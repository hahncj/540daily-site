# 540 News — Discovery Decision Record

Recorded: 2026-11-05. Historical record of the discovery conversation. Some implementation details were inferred while documenting answers; the consolidated requirements distinguish product decisions from recommended defaults. Earlier mentions of open details are resolved by later decisions or the final requirements.

Use [REQUIREMENTS.md](REQUIREMENTS.md) as the current specification.

"Reference application", "reference kit", and "reference architecture" below mean the earlier app whose patterns were adapted for 540 News. Those patterns now live in this folder's technical documents, starting with [ARCHITECTURE.md](ARCHITECTURE.md).

## Decision log

### D1 — Public reading, restricted editing

Confirmed by the owner on 2026-11-05:

- Anyone may read published content.
- All update/edit functions require authentication.
- Shared news editing access is limited to the owner and a small group. Reader accounts may update their own preferences (D5).
- Enforce write permissions on the server, including any enabled APIs and agent tools; hiding editing controls is insufficient.
- Google sign-in is confirmed in D6. Only the owner manages invitations and editor access (D27). Other editor permissions remain to be defined.

### D2 — Automatic publishing

Confirmed by the owner on 2026-11-05:

- Publish AI-discovered stories automatically; no manual approval queue is required before publication.
- Automated publishing must use an authorized service identity or authenticated agent connection. Public visitors cannot publish.
- Research sources, quality checks, schedules, and correction handling remain undecided.

### D3 — Built-in jobs and external agents

Confirmed by the owner on 2026-11-05:

- The longer-term product supports built-in jobs to discover, summarize, and publish content. These are deferred beyond launch by D15.
- External AI agents can also submit content for automatic publication through authenticated integrations.
- Both paths must enforce the same content validation and publishing rules.
- Scheduling, external agent tools, duplicate handling across ingestion paths, and usage limits remain undecided.

### D4 — Shared and individual dashboards

Confirmed by the owner on 2026-11-05:

- Provide a shared homepage for public readers.
- Also support individual personalized dashboards.
- Personalization does not grant permission to edit or publish shared content.
- Reader accounts and preference storage are resolved in D5. Personalization uses explicit interest selections (D8). Other customization controls remain undecided.

### D5 — Reader accounts and synced preferences

Confirmed by the owner on 2026-11-05:

- Readers sign in to save personal dashboard preferences across devices.
- Store preferences against each reader's account and restrict preference updates to that account's owner.
- Reader accounts do not grant permission to edit or publish shared news.
- Reading published content does not require an account.
- Google sign-in is confirmed in D6. Reader registration is invitation-only (D7).

### D6 — Google sign-in

Confirmed by the owner on 2026-11-05:

- Google is the only sign-in method for reader and editor accounts.
- Use the reference application's Google authentication foundation, extending access controls to distinguish readers from approved editors.
- Signing in with Google does not automatically grant editorial permissions.
- Reader registration is invitation-only (D7). Only the owner manages invitations and editor access (D27).

### D7 — Invitation-only reader accounts

Confirmed by the owner on 2026-11-05:

- Only invited readers may create reader accounts using Google sign-in.
- Visitors without an invitation may still read published content anonymously.
- A reader invitation grants personal dashboard access, not editorial permissions.
- Only the owner manages invitations (D27). Invitation delivery and detailed revocation behavior remain to be specified.

### D8 — Explicit interest selection

Confirmed by the owner on 2026-11-05:

- Readers personalize their dashboards by selecting interests, such as topics, teams, companies, or people.
- Save those selections to the reader account so they follow the reader across devices.
- Do not learn or infer preferences from reading activity.
- The initial interest catalog and whether readers can add custom interests remain undecided.

### D9 — Agent-supplied publications and categories

Confirmed by the owner on 2026-11-05:

- The owner plans to build research agents outside this application.
- Those agents find data and publish it to 540 News through an authenticated integration.
- 540 News persists submitted publications and displays them to readers.
- A category must accompany each publication; category is a required submission field.
- The application may include default categories. No exact default list is confirmed.
- Previously unknown categories are created automatically (D10).
- Built-in jobs remain part of the longer-term direction (D3), but are deferred beyond launch (D15).

### D10 — Automatic category creation

Confirmed by the owner on 2026-11-05:

- When an authorized agent submits a publication with a new category, create that category automatically and associate the publication with it.
- Do not require prior editorial approval or reject an otherwise valid publication merely because its category is new.
- Category naming validation and duplicate-name normalization are implementation details to define in the final handoff.

### D11 — Stories and research reports

Confirmed by the owner on 2026-11-05:

- Agents can publish individual stories containing a headline, summary, and optional source links (D29).
- Agents can also publish longer research reports or briefings with sections, images, and charts.
- Both publication types are persisted, displayed, and associated with the submitted category.
- This selection does not require standalone dashboard metrics, data tables, or interactive widgets.
- Report bodies use Markdown with image and chart attachments (D25). Attachments are uploaded to and stored by 540 News (D26). Required metadata and accepted attachment formats remain to be defined.

### D12 — MCP and HTTP API publishing

Confirmed by the owner on 2026-11-05:

- Expose both MCP tools and an HTTP API for external agents to publish stories and research reports.
- Both interfaces call the same underlying publication service and enforce the same authorization, validation, persistence, and automatic category creation rules.
- Follow the reference application's same-origin MCP and API architecture.
- Exact tools, endpoints, credential setup, and payload schemas remain to be defined.

### D13 — Agents update only their own publications

Confirmed by the owner on 2026-11-05:

- Authorized agents may create new publications and update publications they previously created.
- Agents cannot update publications owned by another agent.
- Record publication ownership from the authenticated agent identity, not an untrusted owner field in the submission.
- Enforce this ownership restriction consistently through MCP and the HTTP API.
- Define a stable agent identity so credential rotation does not lose publication ownership.
- Agent deletion permissions are not granted by this decision. Editor-only version history and restoration are confirmed in D14. Other editor permissions remain to be defined.

### D14 — Editor-only version history and restoration

Confirmed by the owner on 2026-11-05:

- Preserve previous publication versions when content is updated by an agent or editor.
- Only authorized editors may view version history and restore an earlier version; public visitors and reader accounts cannot access it.
- Public readers see the current published version.
- Record who made each change and when. Restoration must retain the intervening history rather than erase it.
- Version retention duration remains undecided.

### D15 — External-agent launch; built-in research later

Confirmed by the owner on 2026-11-05:

- Launch with authenticated external agents publishing through MCP and the HTTP API.
- The application receives, validates, persists, and displays their publications.
- Defer built-in research jobs to a later phase. Do not make an internal research scheduler or research AI provider a launch dependency.
- External research agents are built outside this application; building those agents is outside this app's launch scope.
- This phases D3 rather than removing its longer-term goal.
- External agents generate and publish daily briefings for on-site reading at launch (D16).

### D16 — On-site daily briefings

Confirmed by the owner on 2026-11-05:

- At launch, external agents generate and publish daily briefings as reports.
- Readers open briefings on the site using the report-reading experience.
- Email delivery is outside launch scope.
- Briefing research and scheduling remain outside the application at launch, consistent with D15.
- Briefing content and presentation details remain to be defined.

### D17 — Dashboard overview with drill-down

Confirmed by the owner on 2026-11-05:

- The homepage should present a dashboard overview.
- Readers can drill into dashboard content to explore more detail, including individual stories and research reports.
- Do not substitute a magazine layout or a plain headline feed as the primary experience.
- Dashboard panels represent categories (D18). The intermediate drill-down views and layout controls remain undecided.

### D18 — Category panels

Confirmed by the owner on 2026-11-05: category panels (option 1).

- Organize the dashboard into category panels showing recent highlights.
- Readers can drill into a category to explore its publications and then open an individual story or report.
- Panels show recent headlines and short summaries (D19). Readers choose visible panels and their order on personal dashboards (D20); editors control shared homepage category selection and ordering (D21).

### D19 — Headlines and summaries in category panels

Confirmed by the owner on 2026-11-05:

- Each category panel shows recent publication headlines and short summaries.
- Headlines link to the corresponding story or research report; category drill-down provides more publications.
- A separate AI-written category overview is not required for launch.
- The number of publications per panel and summary length remain to be specified.

### D20 — Choose and reorder personal categories

Confirmed by the owner on 2026-11-05:

- Signed-in readers can choose which category panels appear on their personal dashboards and change their order.
- Persist category visibility and ordering in the reader account so preferences follow the reader across devices.
- Personal dashboard changes do not alter the shared public homepage or another reader's dashboard.
- Reader-controlled panel resizing is not required for launch.
- Editors control shared homepage category selection and ordering (D21).

### D21 — Editor-managed public homepage

Confirmed by the owner on 2026-11-05:

- Authorized editors choose which category panels appear on the shared public homepage and set their order.
- Automatically creating a category from an agent submission does not automatically add its panel to the public homepage.
- This homepage selection does not introduce publication approval: valid agent submissions still publish automatically.
- Public homepage configuration is separate from each reader's personal dashboard preferences.

### D22 — Indefinite publication retention

Confirmed by the owner on 2026-11-05:

- Retain published stories and research reports indefinitely in the searchable archive.
- Do not automatically expire or remove publications based on age.
- Older publications remain discoverable even after they leave recent dashboard highlights.
- This decision covers publication retention; editors may unpublish and restore content (D28); historical revision retention remains a separate decision.

### D23 — Keyword search and filters

Confirmed by the owner on 2026-11-05:

- Launch with keyword search across published titles, summaries, and story/report body text.
- Provide filters for category, date, and publication type.
- Search covers the current published versions, including historical publications retained in the archive; editor-only revisions must not appear in public results.
- AI question answering over stored publications is outside launch scope.
- Date-filter semantics and result ordering remain implementation details to specify.

### D24 — Personal bookmarks

Confirmed by the owner on 2026-11-05:

- Signed-in readers can save and unsave stories and research reports.
- Provide a personal saved-publications list, persisted against the reader account and accessible across devices.
- Readers can access and manage only their own bookmark lists.
- Bookmarks reference the publication rather than creating a separate frozen copy of its content.

### D25 — Markdown reports with attachments

Confirmed by the owner on 2026-11-05:

- Agents submit research report bodies as Markdown, with image and chart attachments.
- Preserve the Markdown source for subsequent authorized editing and version history.
- Render Markdown and its attachment references in the report detail view.
- Render submitted content safely; do not execute embedded scripts or arbitrary HTML from agent submissions.
- Use the same content format through MCP and the HTTP API.
- Attachment upload and app-managed storage are confirmed in D26. Required publication metadata, file formats, and size limits remain to be specified.

### D26 — App-managed attachment storage

Confirmed by the owner on 2026-11-05:

- Agents upload image and chart attachments to 540 News, which stores and serves them.
- Published reports reference these stored attachments rather than relying on externally hosted attachment URLs.
- Attachment uploads require authorized publishing or editing credentials.
- Retain attachments referenced by retained publications or retained revisions so archive content and restoration remain usable.
- The reference kit's Cloudflare R2 storage pattern is the implementation baseline; use a new bucket dedicated to 540 News.
- Accepted formats, upload limits, and cleanup of unreferenced uploads remain to be specified.

### D27 — Owner-only access management

Confirmed by the owner on 2026-11-05:

- Only the owner can issue/manage reader invitations and grant or revoke editor access.
- Editors manage content but cannot invite users or change account roles.
- Reader accounts manage their own preferences and bookmarks, not other users' access.
- Enforce owner-only access management on the server, not merely by hiding controls.
- Owner account setup, invitation delivery, and detailed revocation behavior remain to be specified.

### D28 — Unpublish and restore

Confirmed by the owner on 2026-11-05:

- Authorized editors can unpublish a publication and later restore it to public view.
- Preserve unpublished content, its attachments, and its version history.
- Exclude unpublished content from public dashboards, category lists, search results, and public detail access. Reader bookmarks must not expose unpublished content.
- Enforce visibility on the server, including attachment access where it would reveal unpublished content.
- Permanent deletion is not required at launch.
- Agent permissions remain create/update-own only; this decision does not grant agents permission to override an editor's unpublishing action.

### D29 — Optional source links

Confirmed by the owner on 2026-11-05:

- Source links are optional for publications.
- Allow original commentary and reports without external sources; do not reject a publication solely because it has no source links.
- Display source links when supplied. Do not invent citations or imply that unsourced content has been independently verified.
- This decision does not remove the required category or other agreed publication fields.

### D30 — Duplicate-retry protection

Confirmed by the owner on 2026-11-05:

- Require an agent-supplied unique publication ID and scope it to the authenticated agent identity.
- Repeating the same creation submission returns the existing publication rather than creating another copy, including retries across MCP and HTTP API.
- A repeated creation ID with different content must not silently overwrite the publication; return a conflict and require an explicit authorized update.
- Enforce uniqueness in persistent storage so concurrent retries cannot create duplicates.
- Similar-story detection or overlap flagging across agents is not required at launch.

### D31 — Direct editorial authoring

Confirmed by the owner on 2026-11-05:

- Authorized editors can create stories and research reports directly in the site.
- Provide Markdown editing with a rendered preview, publication metadata fields, and attachment uploads.
- Editors can also edit existing publications through this interface.
- Apply the same content validation, category requirements, optional source-link rules, and version history as agent submissions.
- Creating or editing content requires server-enforced editorial permissions.

### D32 — Light and dark themes

Confirmed by the owner on 2026-11-05:

- Provide both light and dark themes and let readers switch between them.
- Apply the selected theme consistently across dashboards, search, publication details, and account/editor interfaces.
- Ensure text, controls, and focus indicators remain readable in both themes.
- Default theme and theme-preference storage remain implementation details to specify.

### D33 — Separate Cloudflare application in the existing account

Confirmed by the owner on 2026-11-05:

- Use Cloudflare for hosting and databases.
- Use the owner's existing Cloudflare account; a new account is not required.
- Deploy 540 News as a separate site/application with dedicated databases, independent of the existing site's resources and data.
- Follow the reference architecture with a dedicated Worker and D1 database; use a dedicated R2 bucket for app-managed attachments (D26).
- Give resources distinct names and configure only 540 News resource bindings. Do not reuse or migrate the existing site's data.
- Project name and website address are confirmed in D34. Exact database and bucket names remain to be specified. This requirements decision does not authorize provisioning or deployment during discovery.

### D34 — Project name and website address

Confirmed by the owner on 2026-11-05:

- Product display name: **540 News**.
- Project name: `540news-site`.
- Website address and intended production origin: `https://540news.com`.
- This supersedes the earlier ambiguous `540work-site` value.
- Use the production origin consistently for site links, authentication, and agent integration configuration.
- Domain ownership, DNS configuration, and deployment readiness have not been verified during requirements discovery.

## D35 — Finish with recommended defaults

The owner authorized recommended defaults for remaining implementation details and preparation of the build-ready Markdown handoff. Defaults are labeled in the consolidated requirements; they are not represented as individual owner selections.

## D36 — Agents act as the member who connected them

Confirmed by the owner on 2026-11-06. Supersedes the stable agent identity in D13 and the owner-approved agent mapping in the earlier requirements.

- Google sign-in decides access. An MCP connection or API key acts as the member who created it, with that member's current role.
- No separate agent identities and no owner approval step per agent. Any active member can approve their own MCP connection; readers' connections are read-only.
- Guardrails kept: agent interfaces only create publications and update the member's own publications; they have no unpublish, restore, delete, layout, or access-management operations.
- Duplicate-retry protection is scoped to the member, so retries across MCP and HTTP still return one publication.
- Members manage their own connections and keys; the owner can revoke any member's.
