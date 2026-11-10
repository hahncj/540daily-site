// HTTP API at /api/v1/*. Thin: authenticate the agent, parse the request, and run the same operation
// the MCP tools run (server/integration.ts), so both interfaces share validation and data shapes.
//
//   GET   /api/v1/categories                list_categories
//   GET   /api/v1/publications              search_publications (?q, category, type, from, to, page)
//   GET   /api/v1/publications/:id          get_publication
//   POST  /api/v1/publications              create_publication
//   PATCH /api/v1/publications/:id          update_publication
//   POST  /api/v1/attachment-uploads        prepare_attachment_upload
//   GET   /api/v1/attachments/:id           upload status (uploader only)
//   PUT   /api/v1/uploads/:token            upload the bytes (the ticket is the credential)
import { authenticateAgent } from "./agent-auth";
import type { Services } from "./app";
import { errorResult, MAX_JSON_BODY_BYTES, logOperation, rateLimitedResult, runOperation, type OperationName, type OperationResult } from "./integration";
import { handleUpload, isUploadPath, readBodyAtMost } from "./media-routes";


const NO_STORE = { "Cache-Control": "no-store" };

type Route = { op: OperationName; id?: string } | { notAllowed: string[] } | null;

function route(method: string, path: string): Route {
  const parts = path.replace(/^\/api\/v1\/?/, "").split("/");
  const [resource, rawId, extra] = parts;
  if (extra !== undefined) return null;
  let id: string | undefined;
  if (rawId !== undefined) {
    try {
      id = decodeURIComponent(rawId);
    } catch {
      return null;
    }
    if (!id) return null;
  }
  const allow = (allowed: Record<string, OperationName>): Route => (allowed[method] ? { op: allowed[method], id } : { notAllowed: Object.keys(allowed) });
  if (resource === "categories" && id === undefined) return allow({ GET: "list_categories" });
  if (resource === "publications" && id === undefined) return allow({ GET: "search_publications", POST: "create_publication" });
  if (resource === "publications") return allow({ GET: "get_publication", PATCH: "update_publication" });
  if (resource === "attachment-uploads" && id === undefined) return allow({ POST: "prepare_attachment_upload" });
  if (resource === "attachments" && id !== undefined) return allow({ GET: "get_attachment" });
  return null;
}

function respond(result: OperationResult, extraHeaders: Record<string, string> = {}): Response {
  const headers: Record<string, string> = { ...NO_STORE, ...extraHeaders };
  if (result.httpStatus === 401) headers["WWW-Authenticate"] = 'Bearer realm="540daily"';
  const retryAfter = result.body.retryAfterSeconds;
  if (result.httpStatus === 429 && typeof retryAfter === "number") headers["Retry-After"] = String(retryAfter);
  return Response.json(result.body, { status: result.httpStatus, headers });
}

export async function handleApiV1(request: Request, services: Services): Promise<Response> {
  const url = new URL(request.url);
  if (isUploadPath(url.pathname)) return handleUpload(request, services);

  const started = Date.now();
  const operationId = services.newId();
  const early = (result: OperationResult, operation: string, headers?: Record<string, string>, who?: { userId: string; credentialKind: string; credentialId: string }) => {
    logOperation({
      operationId,
      interface: "http",
      operation,
      userId: who?.userId ?? null,
      credentialKind: who?.credentialKind ?? null,
      credentialId: who?.credentialId ?? null,
      status: result.body.status,
      httpStatus: result.httpStatus,
      durationMs: Date.now() - started,
    });
    return respond(result, headers);
  };

  const matched = route(request.method, url.pathname);
  if (!matched) return early(errorResult(404, "not_found", "No such API endpoint."), "unknown");
  if ("notAllowed" in matched) {
    return early(errorResult(405, "method_not_allowed", `Use ${matched.notAllowed.join(" or ")}.`), "unknown", { Allow: matched.notAllowed.join(", ") });
  }

  // Credentials first, even for reads: agent APIs always require them.
  const auth = await authenticateAgent(request, services);
  if (!auth.ok) {
    const message = auth.reason === "missing" ? "Send an API key or access token as: Authorization: Bearer <token>." : "The API key or access token is invalid, expired, or revoked.";
    return early(errorResult(401, "unauthorized", message), matched.op);
  }
  const agent = auth.principal;
  const limited = await services.rateLimits.hit(agent.userId, "requests");
  if (!limited.allowed) return early(rateLimitedResult(limited.retryAfterSeconds, "requests"), matched.op, undefined, agent);

  let input: unknown;
  if (request.method === "POST" || request.method === "PATCH") {
    const body = await readJsonBody(request);
    if (!body.ok) return early(body.result, matched.op, undefined, agent);
    input = body.value;
    if (matched.id !== undefined) input = { ...(input as Record<string, unknown>), id: matched.id };
  } else if (matched.op === "search_publications") {
    input = searchInputFrom(url.searchParams);
  } else {
    input = matched.id !== undefined ? { id: matched.id } : {};
  }

  return respond(await runOperation(services, agent, matched.op, input, { interface: "http", operationId }));
}

async function readJsonBody(request: Request): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; result: OperationResult }> {
  const tooLarge = { ok: false as const, result: errorResult(413, "too_large", `Request bodies can be at most ${MAX_JSON_BODY_BYTES / 1024} KB.`) };
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_JSON_BODY_BYTES) return tooLarge;
  const body = await readBodyAtMost(request, MAX_JSON_BODY_BYTES);
  if (body.overflow) return tooLarge;
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(body.bytes));
  } catch {
    return { ok: false, result: errorResult(400, "bad_request", "The request body must be a JSON object.") };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, result: errorResult(400, "bad_request", "The request body must be a JSON object.") };
  }
  return { ok: true, value: value as Record<string, unknown> };
}

/** Query string → the same search input MCP sends. Unknown parameters are kept so validation reports them. */
function searchInputFrom(params: URLSearchParams): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const [key, value] of params) {
    if (key === "page") input.page = /^\d{1,6}$/.test(value) ? Number(value) : value;
    else input[key] = value;
  }
  return input;
}
