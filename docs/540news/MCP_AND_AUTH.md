# MCP, HTTP API, and authentication

How members sign in, how agents authenticate, and how the MCP and HTTP interfaces are built. The operations, field rules, and status codes are defined in [REQUIREMENTS.md](REQUIREMENTS.md) sections 4, 6, 8, and 9; this document covers implementation.

Labels: **Proven** means the pattern worked in the earlier production app this design is based on. **Proposed** means a design choice made for 540 News that the requirements leave open. A build agent may refine a Proposed item if it records why.

## 1. Where things run

| Component | Runs where | Responsibility |
| --- | --- | --- |
| MCP endpoint `/mcp` | Same Worker, same origin | Authenticate the agent, build an `McpServer` per request, dispatch JSON-RPC |
| MCP tools | Same Worker, in-process | Validate args with zod, call core services, return JSON results |
| HTTP API `/api/v1/*` | Same Worker | Same operations as MCP over plain HTTP |
| OAuth authorization server | Better Auth at `/api/auth/*` and `/.well-known/*` | Discovery, client registration and CIMD, authorize, token, JWKS |
| Sign-in and consent screens | React Router pages `/sign-in`, `/consent` | Human steps of Google sign-in and MCP OAuth |

Nothing MCP runs in the browser. Tools reach core services through in-process calls on the shared `Services` object, not over the network.

## 2. Member sign-in (Google, invitation-only)

**Proven base, adapted for 540 News.** Better Auth with Google is the only sign-in method; email/password is disabled.

```ts
// server/auth/auth.ts (shape)
export const AUTH_BASE_PATH = "/api/auth";
export const MCP_PATH = "/mcp";
export const mcpResourceUrl = (config: AppConfig) => `${config.baseUrl}${MCP_PATH}`;

export function createAuth({ config, db, fetchClientMetadata }: {
  config: AppConfig; db: Database; fetchClientMetadata: ClientMetadataResourceFetch;
}) {
  return betterAuth({
    baseURL: config.baseUrl,
    basePath: AUTH_BASE_PATH,
    secret: config.authSecret,
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    emailAndPassword: { enabled: false },
    socialProviders: {
      google: { clientId: config.google.clientId, clientSecret: config.google.clientSecret, overrideUserInfoOnSignIn: true },
    },
    disabledPaths: ["/token"],          // the JWT plugin's session-to-JWT endpoint is not needed
    advanced: { ipAddress: { ipAddressHeaders: config.clientIpHeaders } },
    user: { validateUserInfo: membershipGate(db, config.ownerEmail) },
    plugins: [
      jwt(),
      mcp({
        loginPage: "/sign-in",
        consentPage: "/consent",
        resource: mcpResourceUrl(config),
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationDefaultApplicationType: "infer",
      }),
      cimd({ fetchClientMetadataResource: fetchClientMetadata, metadataProfile: "mcp-2026-07-28" }),
    ],
  });
}
```

`membershipGate` replaces the earlier app's admin allow-list. It accepts a verified Google email only if one of these is true:

- it equals `OWNER_EMAIL` (case-insensitive), which bootstraps the owner;
- it matches an open, unrevoked invitation (exact email, normalized for case, no Gmail alias rewriting); or
- it belongs to an existing active member.

Otherwise it returns an error and no user is created. Disabled members are rejected.

Accepting an invitation creates the membership row (role `reader`) and marks the invitation accepted. **Proposed:** if Better Auth's hook cannot write app tables atomically with user creation, do it in a database hook (`databaseHooks.user.create.after`) and make it idempotent.

After changing plugins, regenerate the auth tables with `npm run auth:schema` and then run `npm run db:generate`.

**Browser client (proven):**

```ts
// app/auth-client.ts
import { createAuthClient } from "better-auth/react";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
export const authClient = createAuthClient({ basePath: "/api/auth", plugins: [oauthProviderClient()] });
```

Sign-in page: `authClient.signIn.social({ provider: "google", callbackURL: next })`. Validate `next` as a same-site relative path. The OAuth provider plugin carries the signed OAuth query through sign-in, so an MCP flow resumes afterward.

**CIMD fetch on Workers (proven).** `@better-auth/cimd/node` cannot run on Workers, so the Worker passes its own fetcher: HTTPS only, GET/HEAD only, `isPublicRoutableHost(url.hostname)` from `@better-auth/core/utils/host`, and `redirect: "manual"` with any 3xx turned into a thrown `TypeError` (Workers do not support `redirect: "error"`). The Node test host uses `fetchClientMetadataResource` from `@better-auth/cimd/node`.

## 3. Member access checks

`getViewer(request, services)` calls `auth.api.getSession({ headers })` and then reads the member's **current** role and status from D1 on every request. Disabling a member, or changing their role, takes effect on their next request. Disabling also deletes their sessions.

```ts
// app/access.server.ts (shape)
export async function requireRolePage(request: Request, services: Services, min: Role) {   // GET pages
  const viewer = await getViewer(request, services);
  if (viewer && hasRole(viewer, min)) return viewer;
  if (viewer) throw new Response("You don't have access to this page.", { status: 403 });
  const url = new URL(request.url);
  throw redirect(`/sign-in?next=${encodeURIComponent(url.pathname + url.search)}`);
}
export async function requireRoleWrite(request: Request, services: Services, min: Role) { // actions
  assertSameOrigin(request);                  // CSRF: reject cookie writes from other origins
  const viewer = await getViewer(request, services);
  if (viewer && hasRole(viewer, min)) return viewer;
  throw new Response(viewer ? "You don't have access to do that." : "Sign in to do that.", { status: viewer ? 403 : 401 });
}
```

Roles rank `reader < editor < owner`. Owner-only operations (invitations, roles, agents, credentials, upload cleanup) require `owner`. Reader-owned data (preferences, bookmarks) is also scoped by `viewer.userId` inside core, not just by role. The first line of every write action is a `requireRoleWrite` call.

**Same-origin check (Proposed):** for cookie-authenticated POST/PUT/PATCH/DELETE, require the `Origin` header (or, if absent, `Sec-Fetch-Site: same-origin`) to match `PUBLIC_BASE_URL`. Better Auth applies its own checks to `/api/auth/*`.

## 4. Agent identities and credentials

An **agent** is a stable record (`agents` table: id, owner-managed label, enabled flag, timestamps). Publications record the agent ID as creator, so rotating or revoking a credential never changes ownership.

Agents authenticate in one of two ways. Both resolve to the same `AgentPrincipal`.

**API keys (proven pattern, now mapped to agents).** Format: a 540 News prefix plus `_` plus base64url of 32 random bytes. Show the key once, at creation. Store only a SHA-256 base64url hash, a short display prefix, the agent ID, `created_by`, `last_used_at` (updated at most once an hour), and `revoked_at`. The owner creates, rotates, and revokes keys on `/owner`.

**OAuth connections (proven flow, new agent mapping).**

- The `/consent` page is **owner-only (Proposed)**. Its loader verifies the signed query with `verifyOAuthQueryParams(url.search.slice(1), (await services.auth.$context).secret)` and returns 400 if it is invalid. It redirects a signed-out user to `/sign-in?<query>` and returns 403 to non-owners. It shows the client's name and a domain taken from the CIMD URL or redirect URI, which is harder to fake than the self-supplied name.
- On **Allow**, the owner picks an existing agent identity or creates a new one. The action stores a row in `agent_oauth_clients (client_id primary key, agent_id, approved_by, approved_at, revoked_at)` and then calls `authClient.oauth2.consent({ accept: true })`.
- A token whose client has no active mapping is **unmapped**: write tools and write endpoints return 403. **Proposed:** unmapped connections may still call read operations, which only see published content.
- Disconnect (proven): in one `atomic()` write, delete the client's consent rows, set `revoked` on its refresh tokens, and set `revoked_at` on the mapping. Access tokens are self-contained JWTs, so the revocation time is how older tokens get refused.

An owner signing in through OAuth does **not** give the agent the owner's editor powers. Agent tools act only as the mapped agent, with agent permissions.

## 5. Authenticating agent requests

```ts
// server/agent-auth.ts (shape)
export type AgentPrincipal = { agentId: string; credentialKind: "oauth" | "api_key"; credentialId: string; label: string };
export type AgentAuth =
  | { ok: true; principal: AgentPrincipal }
  | { ok: true; principal: null; unmapped: { clientId: string } }       // valid token, no agent mapping
  | { ok: false; reason: "missing" | "invalid" };

export async function authenticateAgent(request: Request, services: Services): Promise<AgentAuth> {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return { ok: false, reason: "missing" };

  if (token.startsWith(API_KEY_PREFIX)) {
    const key = await services.agents.verifyApiKey(token, services.now());   // hash lookup, not revoked
    if (!key || !key.agentEnabled) return { ok: false, reason: "invalid" };
    return { ok: true, principal: { agentId: key.agentId, credentialKind: "api_key", credentialId: key.id, label: key.agentLabel } };
  }

  let claims;
  try {
    const { baseURL: issuer } = await services.auth.$context;
    claims = await verifyJwsAccessToken(token, {
      jwksFetch: async () => services.auth.api.getJwks(),   // in-process: a Worker cannot fetch its own hostname
      jwksCacheKey: services.auth,
      verifyOptions: { issuer, audience: mcpResourceUrl(services.config), requiredClaims: ["azp", "sub", "iat"] },
    });
  } catch {
    return { ok: false, reason: "invalid" };
  }
  // Then: reject if the OAuth client is disabled, if the mapping was revoked at or after `iat`,
  // or if the agent is disabled. Return `unmapped` when no active mapping exists.
}
```

This runs on **every** MCP and HTTP request, so revoking a key, disconnecting a client, or disabling an agent stops writes immediately. Never log tokens or keys.

## 6. MCP endpoint

**Transport (proven):**

| Aspect | Value |
| --- | --- |
| SDK | `@modelcontextprotocol/server` (see [STACK.md](STACK.md)) |
| Transport | Streamable HTTP via `createMcpHandler(factory, { legacy: "stateless" })`, web-standard `fetch(request, { authInfo })` |
| Protocol versions | 2026-07-28 and 2025-era clients (legacy stateless fallback). Tests send `MCP-Protocol-Version: 2025-06-18` |
| Endpoint | `POST https://540news.com/mcp` (exact path) |
| Sessions | None. New `McpServer` per request. Legacy GET/DELETE session calls get 405 |
| Request headers | `Authorization: Bearer <token>`, `Content-Type: application/json`, `Accept: application/json, text/event-stream` |
| Response | JSON or `text/event-stream` (one `data:` line per message); clients and tests handle both |
| Unauthenticated | HTTP 401, body `{"jsonrpc":"2.0","error":{"code":-32001,"message":"Authentication required"},"id":null}`, header `WWW-Authenticate: Bearer resource_metadata="<PUBLIC_BASE_URL>/.well-known/oauth-protected-resource/mcp"` |
| Invalid token | Same, plus `error="invalid_token", error_description="The access token is invalid, expired, or revoked"` |

**OAuth discovery (proven, served by Better Auth):**

| Path | Key fields |
| --- | --- |
| `/.well-known/oauth-protected-resource/mcp` | `resource: "<PUBLIC_BASE_URL>/mcp"`, `authorization_servers: ["<PUBLIC_BASE_URL>/api/auth"]` |
| `/.well-known/oauth-authorization-server/api/auth` | `issuer`, `registration_endpoint`, `code_challenge_methods_supported: ["S256"]`, `client_id_metadata_document_supported: true` |
| `/api/auth/oauth2/register` | Dynamic client registration (older clients) |
| `/api/auth/oauth2/authorize` | Redirects to `/sign-in` or `/consent` |
| `/api/auth/oauth2/consent` | Called by the consent page |
| `/api/auth/oauth2/token` | Code + PKCE → JWT access token (audience `<PUBLIC_BASE_URL>/mcp`) + refresh token |
| `/api/auth/callback/google` | Google redirect URI |

```ts
// server/mcp/endpoint.ts (shape)
export async function handleMcp(request: Request, services: Services): Promise<Response> {
  const auth = await authenticateAgent(request, services);
  if (!auth.ok) return unauthorized(services.config, auth.reason === "invalid");
  return createMcpRequestHandler(services, auth).fetch(request, {
    authInfo: { token: "", clientId: auth.principal?.credentialId ?? auth.unmapped.clientId, scopes: [], extra: { agentId: auth.principal?.agentId ?? null } },
  });
}
```

```ts
// server/mcp/server.ts (shape)
const INSTRUCTIONS = `This is 540 News, a public news and research site.
- Publish stories and reports with create_publication. Always send a unique externalId; resending the same payload with the same externalId is safe and returns the original.
- To change a publication, call update_publication with expectedRevision from your last read.
- Upload images with prepare_attachment_upload first, then reference them in Markdown as ![alt text](attachment:ID).
- Every publication needs a category. New categories are created automatically.`;

function result(data: unknown, isError = false) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], structuredContent: data as Record<string, unknown>, isError };
}

export function createAppMcpServer(services: Services, auth: AgentAuthOk): McpServer {
  const server = new McpServer({ name: "540-news", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  server.registerTool("create_publication", {
    title: "Publish a story or report",
    description: "Create and immediately publish a story or report. Requires a unique externalId.",
    inputSchema: publicationCreateShape,          // zod raw shape shared with the HTTP API, from core
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args) => {
    const outcome = await services.publications.createFromAgent(auth, args);
    return result(toIntegration(outcome, services.config.baseUrl), !outcome.ok);
  });
  // list_categories, search_publications, get_publication: readOnlyHint true
  // update_publication: idempotentHint false
  // prepare_attachment_upload: returns an upload ticket (section 7)
  return server;
}

export function createMcpRequestHandler(services: Services, auth: AgentAuthOk) {
  return createMcpHandler(() => createAppMcpServer(services, auth), { legacy: "stateless" });
}
```

**Conventions (proven):**

- `inputSchema` is a zod **raw shape** with `.max()` bounds and a `.describe()` on every field. Shared schemas live in core, so MCP and HTTP validate identically.
- Each result is `{ content: [text JSON], structuredContent, isError }`.
- Business errors are tool results with `isError: true` and `{ "status": "...", "message": "...", "errors"?: {...} }`. They are not JSON-RPC errors. Auth errors are HTTP 401.
- Status vocabulary: `created`, `replayed`, `updated`, `conflict`, `validation_failed`, `not_found`, `forbidden`, `rate_limited`.
- One module (`server/integration.ts`) builds the publication JSON for both MCP and HTTP, including an absolute `url` from `config.baseUrl`, so the two interfaces return identical shapes.

**Claude Code with an API key:**

```bash
claude mcp add --transport http 540news https://540news.com/mcp --header "Authorization: Bearer <AGENT_API_KEY>"
```

## 7. HTTP API

Same operations as MCP ([REQUIREMENTS.md](REQUIREMENTS.md) section 9), calling the same core functions.

- `Authorization: Bearer <API key or OAuth JWT>`; 401 responses carry `WWW-Authenticate: Bearer realm="540news"`.
- JSON bodies are capped at **256 KB (Proposed;** the earlier app used this cap). Check both `content-length` and the actual text length; return 413 when over.
- Responses: `{ status, message, ... }` with the matching HTTP status and `Cache-Control: no-store`.
- Error statuses follow the requirements' table. Do not reveal whether a private item exists: another agent's unpublished item returns 404.

**Attachment upload flow (Proposed endpoint shapes; the requirements fix the initiation call only):**

1. `POST /api/v1/attachment-uploads` (or MCP `prepare_attachment_upload`) with `{ mimeType, size, altText }` → `{ attachmentId, uploadUrl, expiresAt }`. The ticket is short-lived, single-use, and bound to the agent, MIME type, and declared size.
2. `PUT <uploadUrl>` with the raw bytes. No other credential is needed because the URL carries the ticket. The server checks the size and the file signature, writes to R2, and marks the attachment `ready`.
3. `GET /api/v1/attachments/:id` → status (`pending`, `ready`, `rejected`) for the uploading agent.
4. Reference it in Markdown as `![alt text](attachment:<attachmentId>)` and list it in `attachmentIds`.

## 8. Rate limits

Defaults from the requirements: per agent, 60 requests per minute, of which at most 10 writes and 5 upload initiations. Configure them through server settings.

**Proposed implementation:** a D1 table `rate_limit_counters (agent_id, bucket, window_start, count)` with a unique key, incremented with an upsert and checked against the limit in the same statement. When over the limit, return 429 with `Retry-After`. D1 is shared storage, so limits hold across Worker instances.

## 9. Operational logging

Log the operation ID, agent ID, operation name, status, and duration with `console.error`/`console.log` (Workers observability collects them). Never log tokens, keys, or request bodies. Also record failed publishing attempts in a bounded D1 table (30-day retention) for the owner's "recent publishing failures" view.

## 10. Verification

| Boundary | Automated (local) check | Live check |
| --- | --- | --- |
| MCP challenge | `POST /mcp` with `{}` → 401 and the exact `WWW-Authenticate` value | `curl -i -X POST https://540news.com/mcp` |
| Discovery | GET both `.well-known` paths; assert the fields in section 6 | Same with curl |
| OAuth flow | `connectAgent()` helper: owner session cookie → register → authorize (302 to `/consent`) → consent with agent mapping → token (200) | Add the connector in an MCP client; approve on `/consent` |
| Wrong audience | Token requested without `resource` → `/mcp` returns 401 | — |
| Unmapped client | Token from a consent without a mapping → write tools return `forbidden` | — |
| MCP protocol | `initialize` returns name and instructions; `tools/list` returns the six tools with correct `readOnlyHint`s | Client lists the tools |
| Tool call → DB | `create_publication`, then read back over MCP and HTTP | Publish a test item; see it on the site |
| Replay across interfaces | Same `externalId` and payload over MCP then HTTP → one publication (A5) | — |
| Revocation | Revoke key or disconnect client → next call 401 (A6) | — |
| Member gates | Route actions called directly: signed out → 401, reader → 403 on editor writes, editor → 403 on owner writes (A1–A3) | Use the UI |
