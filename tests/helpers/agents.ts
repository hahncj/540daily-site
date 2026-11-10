// Agent-interface test helpers: API keys, MCP JSON-RPC calls, HTTP API calls, and the full MCP OAuth
// flow in-process. All identities and content are test data.
import type { Services } from "../../server/app";
import type { Role } from "../../server/core/access";
import { BASE_URL, createMember, request, sessionCookieFor } from "./services";

export const MCP_PROTOCOL_VERSION = "2025-11-25";

/** A new member with an API key (created through the service, as the account screen will). */
export async function memberWithKey(services: Services, email: string, role: Role = "editor") {
  // Readers cannot create keys; create as editor, then set the real role.
  const userId = await createMember(services, email, role);
  const key = await createKeyFor(services, userId, role === "reader" ? "editor" : role);
  return { userId, key };
}

export async function createKeyFor(services: Services, userId: string, role: Role = "editor", label = "Test agent key") {
  const out = await services.apiKeys.create({ userId, role, status: "active" }, label);
  if (!out.ok) throw new Error(`apiKeys.create failed: ${out.message}`);
  return out.value.key;
}

/** Parse a JSON or SSE (`data:` lines) MCP response into its JSON-RPC messages. */
export async function readMcpMessages(response: Response): Promise<Array<Record<string, unknown>>> {
  const text = await response.text();
  if ((response.headers.get("content-type") ?? "").includes("text/event-stream")) {
    return text
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => JSON.parse(line.slice(5).trim()) as Record<string, unknown>);
  }
  return text ? [JSON.parse(text) as Record<string, unknown>] : [];
}

let rpcId = 0;
export async function mcpRequest(services: Services, token: string | null, method: string, params: Record<string, unknown> = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await request(services, "/mcp", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) });
  return response;
}

export async function mcpResult(services: Services, token: string, method: string, params: Record<string, unknown> = {}) {
  const response = await mcpRequest(services, token, method, params);
  if (response.status !== 200) throw new Error(`MCP ${method} returned HTTP ${response.status}: ${await response.text()}`);
  const [message] = await readMcpMessages(response);
  if (!message || message.error) throw new Error(`MCP ${method} failed: ${JSON.stringify(message?.error)}`);
  return message.result as Record<string, unknown>;
}

export type ToolOutcome = { isError: boolean; body: Record<string, unknown> & { status: string; message: string } };

export async function callTool(services: Services, token: string, name: string, args: Record<string, unknown> = {}): Promise<ToolOutcome> {
  const result = (await mcpResult(services, token, "tools/call", { name, arguments: args })) as {
    isError?: boolean;
    structuredContent: ToolOutcome["body"];
    content: Array<{ type: string; text: string }>;
  };
  // The text content mirrors the structured content.
  if (JSON.stringify(JSON.parse(result.content[0]!.text)) !== JSON.stringify(result.structuredContent)) throw new Error("text and structuredContent differ");
  return { isError: result.isError === true, body: result.structuredContent };
}

export async function api(services: Services, token: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const init: RequestInit = { method, headers: { ...headers } };
  if (token) (init.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  if (body !== undefined) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  const response = await request(services, path, init);
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: (text ? JSON.parse(text) : null) as Record<string, unknown> & { status: string; message: string } };
}

const REDIRECT_URI = "http://127.0.0.1:47123/callback";

/** Register an MCP client the way older clients do (dynamic client registration). */
export async function registerClient(services: Services, clientName = "Test MCP client") {
  const response = await request(services, "/api/auth/oauth2/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: "none",
      client_name: clientName,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  if (response.status !== 201) throw new Error(`register failed: ${response.status} ${await response.text()}`);
  return ((await response.json()) as { client_id: string }).client_id;
}

/** Start authorization as a signed-in member. Returns the redirect Location and the PKCE verifier. */
export async function authorize(services: Services, cookie: string, clientId: string, options: { resource?: string | null } = {}) {
  const verifier = crypto.randomUUID() + crypto.randomUUID();
  const challenge = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).toString("base64url");
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    state: "test-state",
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "openid offline_access",
  });
  const resource = options.resource === undefined ? `${BASE_URL}/mcp` : options.resource;
  if (resource) query.set("resource", resource);
  const response = await request(services, `/api/auth/oauth2/authorize?${query}`, { headers: { Cookie: cookie } });
  return { status: response.status, location: response.headers.get("location") ?? "", verifier, resource };
}

/**
 * Full MCP OAuth flow in-process: register → authorize (302 to /consent) → consent → token, with PKCE.
 * Pass `clientId` to reconnect an already-registered client.
 */
export async function connectAgent(
  services: Services,
  member: { cookie: string },
  options: { clientId?: string; clientName?: string; resource?: string | null } = {},
) {
  const clientId = options.clientId ?? (await registerClient(services, options.clientName));
  const started = await authorize(services, member.cookie, clientId, { resource: options.resource });
  if (started.status !== 302 || !started.location.startsWith("/consent?")) throw new Error(`authorize did not reach consent: ${started.status} ${started.location}`);
  const oauthQuery = started.location.slice("/consent?".length);
  const consent = await request(services, "/api/auth/oauth2/consent", {
    method: "POST",
    headers: { Cookie: member.cookie, "Content-Type": "application/json", Origin: BASE_URL },
    body: JSON.stringify({ accept: true, oauth_query: oauthQuery }),
  });
  if (consent.status !== 200) throw new Error(`consent failed: ${consent.status} ${await consent.text()}`);
  const code = new URL(((await consent.json()) as { url: string }).url).searchParams.get("code");
  if (!code) throw new Error("consent returned no code");
  const form = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI, client_id: clientId, code_verifier: started.verifier });
  if (started.resource) form.set("resource", started.resource);
  const token = await request(services, "/api/auth/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  if (token.status !== 200) throw new Error(`token failed: ${token.status} ${await token.text()}`);
  const tokens = (await token.json()) as { access_token: string; refresh_token?: string };
  return { clientId, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, consentQuery: oauthQuery };
}

/** A signed-in member (session cookie) plus their user ID. */
export const signedInMember = sessionCookieFor;
