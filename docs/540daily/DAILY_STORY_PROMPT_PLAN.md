# Daily story prompt: feature plan

Status: **Built** (2026-11-17) on `feature/daily-story-prompt`. Differences from the first draft are noted inline. Not deployed.

## Goal

1. Keep the daily story prompt in 540 Daily's own database, not in each agent's setup.
2. Let connected AI agents read it through MCP (and the HTTP API).
3. Let an admin view, edit, and roll back the prompt on a settings page.
4. Offer a way to run the prompt in the member's connected AI tool. This is a secondary path; most runs will still come from scheduled external agents that read the prompt and then publish.

## Inputs

- **The current prompt text** was supplied by the owner on 2026-11-17 (about 11,000 characters). It is **not** committed to the repo, because it holds a private location (a home ZIP code) and personal interests. The owner pastes it into the admin screen after deploy; that save is revision 1.
- **Who may edit:** the owner only ("admin"). Editors could be added later with one role check.

## Fit with the current prompt

What the supplied prompt implies for this design:

- **No placeholders.** The prompt tells the agent to find the real time at runtime and never reuse an embedded date. So the server returns the text exactly as saved; it does not fill in dates or lists.
- **Private content.** The prompt holds a ZIP code and a personal interest profile. Only the owner and the owner's own agents may read it (not editors, not readers). The read tool never shows on public pages, and the body never goes into audit details or logs.
- **Length.** Allow up to 50,000 characters, well above today's text.
- **Tools it names already exist:** `list_categories`, `search_publications`, `get_publication`, `create_publication`, `update_publication`. No tool changes are needed for it to run.
- **Gap, not in this plan:** the prompt asks the agent to load the "last successful research cutoff", a 30-day dedup history, and evidence records from persistent storage. The site has no place for these today, so agents must keep them elsewhere or rebuild them from `search_publications` (for example, the latest report tagged `briefing`). A small run-log feature could fill this later.

## Design summary

| Piece | Choice |
| --- | --- |
| Storage | D1 table `agent_prompt_revisions` (immutable history; highest revision is current) |
| Core | `services.prompts` in `server/core/prompts.ts` |
| Agent read | MCP tool `get_daily_story_prompt`, HTTP `GET /api/v1/prompts/daily-story` (same `runOperation`) |
| Agent run | MCP **prompt** `daily_story` (`prompts/get`); clients such as Claude show it as a slash command / prompt picker |
| Admin UI | New `/owner` section "Daily story prompt": edit, preview, history, restore |
| In-app AI | **None.** The server never calls a model (AGENTS.md rule stays intact) |

## 1. Data store (migration `0003_agent_prompts.sql`)

Only adds a table, per the migration rule. Built as one table instead of the two first planned: the current prompt is simply the highest revision, so there is no pointer row to keep in step.

```
agent_prompt_revisions
  key               text not null -> agent_prompts.key
  revision          integer not null
  body              text not null           -- Markdown/plain text, max 50,000 chars
  note              text                    -- optional "what changed"
  created_at        integer (timestamp_ms)
  created_by        text  -> user.id
  primary key (key, revision)
```

- Seed: none. Until the owner saves a prompt, the read tool returns `not_found` with "No daily story prompt has been saved yet." Test fixtures use short invented prompts labelled as test data.
- A save is one guarded statement: `INSERT ... SELECT ... WHERE max(revision) = expected`. The primary key also stops a racing save. No `atomic()` batch is needed.
- Restore copies an old body into a **new** revision, matching publication restores.

## 2. Core service (`server/core/prompts.ts`)

`createPrompts({ repo, audit, now })` returning `Result` values (`history` and `restore` are owner-member only):

- `get(actor, key)` → current body, revision, updatedAt. Owner members and owner agents only.
- `update(actor, key, { body, note, expectedRevision })` → owner member only (agents can never change the prompt); `expectedRevision` is 0 for the first save; 409 with `currentRevision` on a stale revision; audit event `prompt.updated` (revision numbers only, never the body).
- `history(actor, key)` and `restore(actor, key, revision, expectedRevision)` → owner only.
- Zod schemas: `promptUpdateSchema`, `promptRestoreSchema`; keys in `PROMPT_KEYS` (only `daily_story`).

Registered as `prompts` in `Services` in `server/app.ts`.

## 3. Agent access

### Read (main path)

- Add `get_daily_story_prompt` to `OPERATION_INPUT_SHAPES` and `execute()` in `server/integration.ts`, so MCP and HTTP return the same body:
  `{ status: "ok", message, prompt: { key, title, revision, updatedAt, text } }` (text exactly as saved).
- Who may read: owner agents only, because the prompt holds private details. Other agents get `forbidden`.
- MCP tool annotations: `readOnlyHint: true`, `idempotentHint: true`.
- The owner's agents get one extra line in the MCP server instructions: call `get_daily_story_prompt` first for a daily run. Other agents do not see the tool, the prompt, or the line.
- HTTP: `GET /api/v1/prompts/daily-story` in `server/api-v1.ts`.

### Run in the connected AI tool (secondary path)

Register an MCP prompt with `server.registerPrompt("daily_story", ...)`:

- One optional argument: `focus` (free text added at the end, e.g. "sports only today").
- `prompts/get` returns one user message: the saved prompt, plus the focus note if given. The prompt already sets externalId rules, so the server adds nothing else.
- Only owner agents see it in `prompts/list`; other members' clients do not.
- Note: a full edition needs live web search and many tool calls. It works in clients with web search (such as Claude with search on); in others the agent should report the blocker, as the prompt already says.
- The member picks "daily_story" in Claude (or any MCP client with prompt support); the client's model runs it with the same 540 Daily tools. No server-side AI, no new keys, works with the stateless handler.
- Same role rule as the read tool.

The settings page also gets a **Copy prompt** button, for tools without MCP prompt support.

### Options considered and not chosen

- **MCP sampling** (server asks the client's model to run the prompt): needs a client that supports sampling and a live session; our `/mcp` is stateless and most clients do not support it. Revisit if client support grows.
- **"Run now" button calling a model from the Worker:** breaks the "no in-app AI calls" rule and needs an AI key. Out of scope; REQUIREMENTS lists built-in jobs as a later phase.

## 4. Placeholders

None (see "Fit with the current prompt"). Can be added later if a prompt needs them.

## 5. Admin screen

New section on `/owner` (`app/routes/owner.tsx`, anchor `#daily-prompt`, added to the owner nav):

- Textarea with the current body, an optional "What changed" note, hidden `expectedRevision`, **Save**.
- Character count.
- **History** list (last 20): revision, date, who, note; each has **View text** and **Restore**. (A side-by-side compare view was dropped to keep it simple.)
- **Copy prompt** button.
- Conflict: the save is refused, the page reloads its data so the newer revision shows in the history, and the draft stays in the box. Saving again replaces the newer revision.
- Action intents: `save-prompt`, `restore-prompt`. Not indexable (owner pages already are not).

## 6. Tests

- `tests/server/prompts.test.ts`: not_found before first save, first save, update, stale revision 409, restore makes a new revision, editors and agents refused for writes, body never in audit details.
- `tests/server/d1-batch.test.ts`: add the update and restore writes (multi-step write rule).
- MCP/HTTP: `get_daily_story_prompt` returns identical bodies; editor and reader agents refused; `prompts/list` shows `daily_story` to owner agents only; `prompts/get` returns the saved text.
- Playwright `tests/e2e/owner-prompt.spec.ts`: owner saves, reads back with an API key, restores; a conflicting save keeps the draft; an editor's key is refused. The existing owner-console axe checks cover the new section.

## 7. Docs to update

Done: `API_AND_MCP_CONTRACT.md` (tool, HTTP route, MCP prompt), `DATA_AND_STORAGE.md` (table), `OPERATING_GUIDE.md` (editing, history, running it), `AGENTS.md` (notes for later work).

## 8. Build order

1. Migration, schema, repo, core service, unit tests.
2. `get_daily_story_prompt` (MCP + HTTP) and the instruction line.
3. MCP prompt `daily_story`.
4. Owner screen.
5. E2E tests and docs. Run `npm run check` and `npm run test:e2e`.

Deploying the migration to production (`db:migrate:remote`) needs the owner's explicit go-ahead. After deploy, the owner pastes the current prompt into `/owner#daily-prompt` and points the scheduled agent at `get_daily_story_prompt` (or the `daily_story` MCP prompt) instead of its local copy.
