// POST /mcp: authenticate the agent on every request, apply the per-member request limit, then hand the
// JSON-RPC exchange to a fresh, stateless MCP server acting as that member.
import { authenticateAgent } from "../agent-auth";
import type { Services } from "../app";
import { logOperation } from "../integration";
import { createMcpRequestHandler } from "./server";

export function protectedResourceMetadataUrl(baseUrl: string) {
  return `${baseUrl}/.well-known/oauth-protected-resource/mcp`;
}

/** 401 with the RFC 9728 challenge MCP clients use to start OAuth. */
export function mcpUnauthorized(baseUrl: string, invalidToken: boolean): Response {
  let challenge = `Bearer resource_metadata="${protectedResourceMetadataUrl(baseUrl)}"`;
  if (invalidToken) challenge += ', error="invalid_token", error_description="The access token is invalid, expired, or revoked"';
  return Response.json(
    { jsonrpc: "2.0", error: { code: -32001, message: "Authentication required" }, id: null },
    { status: 401, headers: { "WWW-Authenticate": challenge, "Cache-Control": "no-store" } },
  );
}

export async function handleMcp(request: Request, services: Services): Promise<Response> {
  const started = Date.now();
  const operationId = services.newId();
  const log = (status: string, httpStatus: number, who?: { userId: string; credentialKind: string; credentialId: string }) =>
    logOperation({
      operationId,
      interface: "mcp",
      operation: "mcp_request",
      userId: who?.userId ?? null,
      credentialKind: who?.credentialKind ?? null,
      credentialId: who?.credentialId ?? null,
      status,
      httpStatus,
      durationMs: Date.now() - started,
    });

  const auth = await authenticateAgent(request, services);
  if (!auth.ok) {
    log("unauthorized", 401);
    return mcpUnauthorized(services.config.baseUrl, auth.reason === "invalid");
  }
  const principal = auth.principal;
  const limited = await services.rateLimits.hit(principal.userId, "requests");
  if (!limited.allowed) {
    log("rate_limited", 429, principal);
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32029, message: `Too many requests. Retry after ${limited.retryAfterSeconds} seconds.` }, id: null },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds), "Cache-Control": "no-store" } },
    );
  }

  let response: Response;
  try {
    response = await createMcpRequestHandler(services, principal).fetch(request, {
      authInfo: {
        token: "", // never pass the credential further than auth
        clientId: principal.credentialId,
        scopes: [],
        extra: { userId: principal.userId, role: principal.role, credentialKind: principal.credentialKind },
      },
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "mcp_request_failed", operationId, error: String(error) }));
    log("unavailable", 500, principal);
    return Response.json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  log(response.ok ? "ok" : "error", response.status, principal);
  return response;
}
