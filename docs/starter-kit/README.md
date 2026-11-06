# Starter kit: full-stack TypeScript app with MCP server, Claude backend, and SQLite on Cloudflare

This kit describes the framework, architecture, and integration patterns of an existing production app (the "source app") so a coding agent can build a **new, separate** app the same way. It was written by reading the source app's code, configuration, and tests. It contains no secrets, resource IDs, or business data from that app.

Everything the new app needs is in these files. The new app does not need access to the source repository.

## Reading order

| # | File | Read it for |
| --- | --- | --- |
| 1 | [README.md](README.md) | This overview |
| 2 | [STACK.md](STACK.md) | Languages, runtimes, exact dependency versions |
| 3 | [ARCHITECTURE.md](ARCHITECTURE.md) | Layers, request routing, data flow, diagrams, request traces |
| 4 | [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) | Directory tree and where new code goes |
| 5 | [MCP_AND_CLAUDE.md](MCP_AND_CLAUDE.md) | Detailed guide: MCP server, OAuth for MCP clients, backend Claude calls |
| 6 | [DATABASE_AND_CLOUD.md](DATABASE_AND_CLOUD.md) | D1 + Drizzle, migrations, R2, provisioning new resources |
| 7 | [IMPLEMENTATION_PATTERNS.md](IMPLEMENTATION_PATTERNS.md) | How to write routes, core logic, validation, errors, tests |
| 8 | [DEVELOPMENT.md](DEVELOPMENT.md) | Install, run, test, lint locally |
| 9 | [DEPLOYMENT.md](DEPLOYMENT.md) | Cloudflare Workers deploy, CI, secrets, what to replace |
| 10 | [DECISIONS_AND_GAPS.md](DECISIONS_AND_GAPS.md) | Observed choices vs. inferred reasons, discrepancies, open questions |
| 11 | [NEW_APP_PROMPT.md](NEW_APP_PROMPT.md) | Copy-paste prompt for the agent building the new app |

## How to use it in a fresh repository

1. Create an empty repository and copy the `starter-kit/` folder into it.
2. Fill in the placeholders in [NEW_APP_PROMPT.md](NEW_APP_PROMPT.md) (app name, purpose, features, new resource names).
3. Give that prompt to a coding agent working in the new repository.
4. The agent scaffolds the app, builds one minimal feature through every integration boundary, and reports what it verified.

Placeholders look like `<APP_NAME>`, `<WORKER_NAME>`, `<D1_DATABASE_NAME>`. Never replace them with the source app's values.

## The stack in one paragraph

One TypeScript codebase. **React Router v8 in framework mode** (server-side rendering) runs inside a **Cloudflare Worker**. The same Worker serves the web pages, an **MCP server at `/mcp`** (official MCP TypeScript SDK v2, stateless Streamable HTTP), an OAuth 2.1 authorization server for MCP clients (**Better Auth** with its `mcp` and `cimd` plugins, plus Google sign-in), and an optional plain HTTP API. Backend code calls **Claude** with the official **Anthropic TypeScript SDK** using structured outputs. Data lives in **Cloudflare D1 (SQLite)** through **Drizzle ORM**, with SQL migrations applied by Wrangler. Files live in **Cloudflare R2**. Tests use Vitest against in-memory SQLite (better-sqlite3) and Playwright against a Node build of the same app.

## Patterns that must be preserved

| Pattern | Summary | Details |
| --- | --- | --- |
| Single Worker, single origin | Pages, MCP endpoint, OAuth endpoints, and APIs are one deployment on one domain | [ARCHITECTURE.md](ARCHITECTURE.md) |
| MCP server exposed at the app's own origin | `POST <APP_ORIGIN>/mcp`, server-side, stateless, OAuth-protected | [MCP_AND_CLAUDE.md](MCP_AND_CLAUDE.md) |
| MCP tools are thin | Tools call the same core services as the UI; no logic in the tool layer | [IMPLEMENTATION_PATTERNS.md](IMPLEMENTATION_PATTERNS.md) |
| Claude only on the backend | API key is a Worker secret; the browser calls app routes, never Anthropic | [MCP_AND_CLAUDE.md](MCP_AND_CLAUDE.md) |
| AI behind a port | Core code depends on an interface; the Anthropic adapter implements it; tests use a fake | [MCP_AND_CLAUDE.md](MCP_AND_CLAUDE.md) |
| D1 + Drizzle + SQL migrations | One Drizzle schema, generated `.sql` migrations, applied with Wrangler | [DATABASE_AND_CLOUD.md](DATABASE_AND_CLOUD.md) |
| Services built per request on Workers | Do not cache the auth instance or services across requests | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Core isolation | `server/core/` imports no framework, host, DB driver, or SDK (lint-enforced) | [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) |
| Config from environment only | zod-validated env, read only in the host entry | [IMPLEMENTATION_PATTERNS.md](IMPLEMENTATION_PATTERNS.md) |

## Optional integrations

| Integration | Status in the source app | Needed in the new app? |
| --- | --- | --- |
| R2 media storage | Used for photos | Only if the app stores files |
| SQLite FTS5 full-text search | Used for catalog search | Only if the app needs text search |
| Plain HTTP API (`/api/v1`) beside MCP | Same operations as MCP | Optional |
| Personal API keys for tools | Bearer `<prefix>_…` keys accepted by MCP and HTTP API | Optional (useful for Claude Code and scripts) |
| Node + Docker alternative host | Same app on Node with a SQLite file | Optional; the Playwright setup uses it, so keep it if you keep that test setup |
| Claude server tools (web search) | Used in one feature | Optional |
| Third-party image search APIs | Business-specific | Not part of the kit |

## What "frontend MCP server" means here

The app exposes an MCP server so agents such as Claude and ChatGPT can integrate with it (confirmed by the owner). In the source app it runs **server-side, inside the same Worker that renders the frontend**, on the app's own origin (`/mcp`). Nothing MCP runs in the browser. The frontend's pages (`/sign-in`, `/consent`) provide the OAuth sign-in and consent screens MCP clients go through. See [DECISIONS_AND_GAPS.md](DECISIONS_AND_GAPS.md), item G1.

## Evidence labels used in this kit

- **Confirmed**: read in the source code, configuration, or tests.
- **Executed**: a command was actually run while preparing the kit (see [DEVELOPMENT.md](DEVELOPMENT.md)).
- **Inferred**: a likely reason, not stated in code.
- **Unknown**: not determinable from the repository.
