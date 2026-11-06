# Build 540 News

You are implementing **540 News**, project **540news-site**, intended for **https://540news.com**.

## Read first

1. Read [REQUIREMENTS.md](REQUIREMENTS.md) in full. It is the authoritative launch specification. Its labeled defaults are authorized implementation choices; do not reopen every discovery question.
2. Read the technical design documents in this order:
   1. [STACK.md](STACK.md): languages, dependencies, version pins (unverified), services.
   2. [ARCHITECTURE.md](ARCHITECTURE.md): one Worker, layers, request routing, project structure.
   3. [MCP_AND_AUTH.md](MCP_AND_AUTH.md): Google sign-in with invitations, roles, agent identities, MCP and HTTP API.
   4. [DATA_AND_STORAGE.md](DATA_AND_STORAGE.md): D1, Drizzle, migrations, atomic writes, search, R2 attachments, backups.
   5. [IMPLEMENTATION_PATTERNS.md](IMPLEMENTATION_PATTERNS.md): config, services, core, routes, errors, safety, tests, lint.
   6. [DEVELOPMENT_AND_DEPLOYMENT.md](DEVELOPMENT_AND_DEPLOYMENT.md): local setup, commands, provisioning, CI/CD, operations, known constraints.
3. Consult [DECISIONS.md](DECISIONS.md) only for historical context. Earlier open items there are resolved by the consolidated requirements.

When a technical document conflicts with REQUIREMENTS.md, the requirements win. Items marked **Proposed** in the technical documents are design choices you may refine; record why. Check the repository's AGENTS.md before editing code.

## Build outcome

Deliver a responsive public category dashboard with drill-down stories/reports, light/dark themes, search, invitation-only Google reader accounts, personal category ordering and interest filters, private bookmarks, editor Markdown authoring/history/unpublish/restore, owner-only access management, authenticated MCP and HTTP agent publishing, automatic categories, retry protection, and uploaded attachments.

Use a dedicated Cloudflare Worker, D1 database, and R2 bucket in the owner's existing account. Never bind to the existing site's resources. Research agents run outside the application at launch. Do not build an internal research scheduler, require an AI API key, or add an editorial approval queue.

## Implementation workflow

1. Inspect the workspace and references. Confirm dependency availability and compatibility before relying on the version pins in STACK.md; report any necessary substitutions and reasons.
2. Implement schema, migrations, membership and agent identities, shared core publication service, and attachment handling. Test ownership, visibility, concurrency, and retry behavior early.
3. Complete MCP and HTTP interfaces over the same service, including credential revocation and OAuth-to-agent mapping. Document a usable attachment upload flow.
4. Build public dashboard/detail/search, then reader personalization/bookmarks, editorial authoring and history, and owner access management.
5. Finish mobile/keyboard behavior, themes, safe Markdown, failure states, export/restore, and operational documentation.
6. Run the requirements' acceptance checks and required repository checks. Fix failures. Report actual results and explicitly distinguish local/fake tests from live integration tests.

Work through the complete launch scope, not only a scaffold or a demo. Use local fixtures clearly labeled as test data; never present invented publications as actual news. Keep integration contracts and setup instructions consistent with the code.

## Missing inputs

Use placeholders for resource IDs, owner email, OAuth credentials, and secrets while implementing locally. Ask one focused question only when a real blocker cannot be resolved from these documents. Production provisioning, secrets, DNS changes, and deployment require explicit authorization when not already granted. Do not treat the planned domain or resource names as proof they exist.

## Deliverables

- Application code and committed migration files.
- Automated tests covering the acceptance criteria and critical browser journeys.
- Local development and production setup guide, `.env`/Worker variable examples with safe placeholders, and architecture instructions for future agents.
- MCP/HTTP contract with create, update, replay/conflict, authentication, and attachment examples.
- Owner/editor operating instructions and backup/restore procedure.
- Short completion report: implemented scope, commands/checks run and outcomes, technical deviations, and remaining operational setup. Do not claim unrun checks passed.
