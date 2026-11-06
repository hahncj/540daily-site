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
      cimd({ fetchClientMetadataResource: fetchClientMetadata /* plus the metadata profile for the current MCP revision */ }),
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

Roles rank `reader < editor < owner`. Owner-only operations (invitations, roles, revoking other members' keys and connections, upload cleanup) require `owner`. Reader-owned data (preferences, bookmarks) is also scoped by `viewer.userId` inside core, not just by role. The first line of every write action is a `requireRoleWrite` call.

**Same-origin check (Proposed):** for cookie-authenticated POST/PUT/PATCH/DELETE, require the `Origin` header (or, if absent, `Sec-Fetch-Site: same-origin`) to match `PUBLIC_BASE_URL`. Better Auth applies its own checks to `/api/auth/*`.

## 4. Agent credentials: agents act as members

**Confirmed (decision D36):** an agent acts as the member who connected it, with that member's current role. There is no separate agent identity and no owner approval step per agent.

```ts
// server/agent-auth.ts (shape)
export type AgentPrincipal = {
  userId: string; role: Role;                      // re-read from D1 on every call
  credentialKind: "oauth" | "api_key";
  credentialId: string;                            // OAuth client ID or API key ID
  label: string;                                   // client name or key label, for attribution
};
```

Members connect agents in one of two ways. Both resolve to the same `AgentPrincipal`.

**MCP connections through OAuth (proven flow).**

- Any active member can approve a connection for their own account on `/consent`. The loader verifies the signed query with `verifyOAuthQueryParams(url.search.slice(1), (await services.auth.$context).secret)` and returns 400 if it is invalid. It redirects a signed-out user to `/sign-in?<query>`. It shows the client's name, a domain taken from the CIMD URL or redirect URI (harder to fake than the self-supplied name), and a plain statement of what the client can do: "This app will act as you. As an editor it can publish and update your own publications." Readers see that the connection is read-only.
- **Allow** calls `authClient.oauth2.consent({ accept: true })`.
- Disconnect (proven): in one `atomic()` write, delete the client's consent rows for that member, set `revoked` on its refresh tokens, and upsert `tool_revocations (user_id, client_id, revoked_at)`. Access tokens are self-contained JWTs, so the revocation time is how older tokens get refused. Members disconnect their own clients on `/account`; the owner can disconnect any member's on `/owner`.

**API keys (proven pattern).** Only editors and the owner can create keys, for their own account, on `/account`. Format: a 540 News prefix plus `_` plus base64url of 32 random bytes. Show the key once, at creation. Store only a SHA-256 base64url hash, a short display prefix, the member's user ID, a label, `last_used_at` (updated at most once an hour), and `revoked_at`. Rotation means creating a new key and revoking the old one; the member's publications are unaffected because they belong to the member, not the key. The owner can revoke any member's key on `/owner`.

**Guardrails on every agent call:**

- Writes need the member's **current** role to be editor or owner. A reader, disabled member, or demoted editor gets 403 on writes.
- Agents only create publications and update publications whose creator is the same member. No agent operation unpublishes, restores, deletes, changes the homepage layout, or manages access.
- An agent update never changes visibility, so it cannot republish an item an editor unpublished.

## 5. Authenticating agent requests

```ts
// server/agent-auth.ts (shape)
export type AgentAuth = { ok: true; principal: AgentPrincipal } | { ok: false; reason: "missing" | "invalid" };

export async function authenticateAgent(request: Request, services: Services): Promise<AgentAuth> {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return { ok: false, reason: "missing" };

  if (token.startsWith(API_KEY_PREFIX)) {
    const key = await services.apiKeys.verify(token, services.now());       // hash lookup, not revoked
    const member = key && (await services.members.getActive(key.userId));  // status and current role
    if (!key || !member) return { ok: false, reason: "invalid" };
    return { ok: true, principal: { userId: member.id, role: member.role, credentialKind: "api_key", credentialId: key.id, label: key.label } };
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
  // Then: reject if the OAuth client is disabled, if a tool_revocations row for (sub, azp) has
  // revoked_at at or after `iat`, or if the member (sub) is not active. Read the current role.
}
```

This runs on **every** MCP and HTTP request, so revoking a key, disconnecting a client, disabling a member, or demoting an editor takes effect immediately. Core then checks the role and ownership rules for the operation. Never log tokens or keys.

## 6. MCP endpoint

**Transport (proven):**

| Aspect | Value |
| --- | --- |
| SDK | `@modelcontextprotocol/server` (see [STACK.md](STACK.md)) |
| Transport | Streamable HTTP via `createMcpHandler(factory, { legacy: "stateless" })`, web-standard `fetch(request, { authInfo })` |
| Protocol versions | The current MCP protocol revision plus older clients through the SDK's stateless fallback. Check which revisions the chosen SDK supports, and have tests send an explicit `MCP-Protocol-Version` header |
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
  return createMcpRequestHandler(services, auth.principal).fetch(request, {
    authInfo: { token: "", clientId: auth.principal.credentialId, scopes: [], extra: { userId: auth.principal.userId, role: auth.principal.role } },
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

export function createAppMcpServer(services: Services, principal: AgentPrincipal): McpServer {
  const server = new McpServer({ name: "540-news", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  server.registerTool("create_publication", {
    title: "Publish a story or report",
    description: "Create and immediately publish a story or report. Requires a unique externalId.",
    inputSchema: publicationCreateShape,          // zod raw shape shared with the HTTP API, from core
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args) => {
    const outcome = await services.publications.createFromAgent(principal, args);
    return result(toIntegration(outcome, services.config.baseUrl), !outcome.ok);
  });
  // list_categories, search_publications, get_publication: readOnlyHint true
  // update_publication: idempotentHint false
  // prepare_attachment_upload: returns an upload ticket (section 7)
  return server;
}

export function createMcpRequestHandler(services: Services, principal: AgentPrincipal) {
  return createMcpHandler(() => createAppMcpServer(services, principal), { legacy: "stateless" });
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
- Error statuses follow the requirements' table. Do not reveal whether a private item exists: another member's unpublished item returns 404.

**Attachment upload flow (Proposed endpoint shapes; the requirements fix the initiation call only):**

1. `POST /api/v1/attachment-uploads` (or MCP `prepare_attachment_upload`) with `{ mimeType, size, altText }` → `{ attachmentId, uploadUrl, expiresAt }`. The ticket is short-lived, single-use, and bound to the member, MIME type, and declared size. Uploads need the editor or owner role.
2. `PUT <uploadUrl>` with the raw bytes. No other credential is needed because the URL carries the ticket. The server checks the size and the file signature, writes to R2, and marks the attachment `ready`.
3. `GET /api/v1/attachments/:id` → status (`pending`, `ready`, `rejected`) for the uploading member.
4. Reference it in Markdown as `![alt text](attachment:<attachmentId>)` and list it in `attachmentIds`.

## 8. Rate limits

Defaults from the requirements: per member (across all of that member's keys and connections), 60 requests per minute, of which at most 10 writes and 5 upload initiations. Configure them through server settings.

**Proposed implementation:** a D1 table `rate_limit_counters (user_id, bucket, window_start, count)` with a unique key, incremented with an upsert and checked against the limit in the same statement. When over the limit, return 429 with `Retry-After`. D1 is shared storage, so limits hold across Worker instances.

## 9. Operational logging

Log the operation ID, member ID, credential ID, operation name, status, and duration with `console.error`/`console.log` (Workers observability collects them). Never log tokens, keys, or request bodies. Also record failed publishing attempts in a bounded D1 table (30-day retention) for the owner's "recent publishing failures" view.

## 10. Verification

| Boundary | Automated (local) check | Live check |
| --- | --- | --- |
| MCP challenge | `POST /mcp` with `{}` → 401 and the exact `WWW-Authenticate` value | `curl -i -X POST https://540news.com/mcp` |
| Discovery | GET both `.well-known` paths; assert the fields in section 6 | Same with curl |
| OAuth flow | `connectAgent()` helper: member session cookie → register → authorize (302 to `/consent`) → consent → token (200) | Add the connector in an MCP client; approve on `/consent` |
| Wrong audience | Token requested without `resource` → `/mcp` returns 401 | — |
| Role limits | Reader connection → write tools return `forbidden`; demote an editor → their next agent write fails (A6) | — |
| Ownership | Agent acting as member A cannot update member B's publication (A6) | — |
| MCP protocol | `initialize` returns name and instructions; `tools/list` returns the six tools with correct `readOnlyHint`s | Client lists the tools |
| Tool call → DB | `create_publication`, then read back over MCP and HTTP | Publish a test item; see it on the site |
| Replay across interfaces | Same `externalId` and payload over MCP then HTTP → one publication (A5) | — |
| Revocation | Revoke key, disconnect client, or disable member → next call 401 (A6) | — |
| Member gates | Route actions called directly: signed out → 401, reader → 403 on editor writes, editor → 403 on owner writes and on other members' keys (A1–A3) | Use the UI |
