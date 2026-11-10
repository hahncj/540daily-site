// The agent operations behind both MCP tools and the HTTP API. Each operation calls the same core
// service and shapes its result here, so MCP `structuredContent` and HTTP JSON bodies are identical.
// Also: write and upload rate limits, and one operational log line per operation (never credentials,
// tokens, or request bodies).
import { z } from "zod";
import type { AgentPrincipal } from "./agent-auth";
import type { Services } from "./app";
import { canUpdatePublication } from "./core/actors";
import { prepareUploadSchema, type AttachmentInfo } from "./core/attachments";
import type { Category } from "./core/categories";
import { ATTACHMENT_SCHEME } from "./core/markdown";
import {
  agentCreateShape,
  attribution,
  publicationPath,
  publicationUpdateShape,
  type Page,
  type Publication,
  type PublicationListItem,
} from "./core/publications";
import { HTTP_STATUS, type Failure, type FailureStatus } from "./core/result";
import { searchShape } from "./core/search";
import type { RateBucket } from "./rate-limits";

export const UPLOAD_PATH_PREFIX = "/api/v1/uploads/";
/** JSON request bodies (HTTP API and MCP) are capped at 256 KB, checked on Content-Length and actual bytes. */
export const MAX_JSON_BODY_BYTES = 256 * 1024;

// ---------------------------------------------------------------------------
// Operations and their input shapes (MCP tool schemas use these; core runs the full validation)
// ---------------------------------------------------------------------------

const publicationId = z.string().min(1).max(100).describe("Publication ID from create_publication or search_publications.");

export const OPERATION_INPUT_SHAPES = {
  list_categories: {},
  search_publications: searchShape,
  get_publication: { id: publicationId },
  create_publication: agentCreateShape,
  update_publication: { id: publicationId, ...publicationUpdateShape },
  prepare_attachment_upload: prepareUploadSchema.shape,
  get_attachment: { id: z.string().min(1).max(100).describe("Attachment ID from prepare_attachment_upload.") },
} as const;

export type OperationName = keyof typeof OPERATION_INPUT_SHAPES;

const OPERATION_BUCKET: Partial<Record<OperationName, RateBucket>> = {
  create_publication: "writes",
  update_publication: "writes",
  prepare_attachment_upload: "uploads",
};

// ---------------------------------------------------------------------------
// Output shapes
// ---------------------------------------------------------------------------

/** `status` values in every body. Failures use the REQUIREMENTS.md section 9 vocabulary. */
export type BodyStatus =
  | "ok"
  | "created"
  | "replayed"
  | "updated"
  | "uploaded"
  | "bad_request"
  | "unauthorized"
  | "validation_failed"
  | "forbidden"
  | "not_found"
  | "method_not_allowed"
  | "conflict"
  | "too_large"
  | "rate_limited"
  | "unavailable";

export type Body = { status: BodyStatus; message: string } & Record<string, unknown>;
export type OperationResult = { httpStatus: number; body: Body; isError: boolean };

const FAILURE_BODY_STATUS: Record<FailureStatus, BodyStatus> = {
  invalid: "validation_failed",
  forbidden: "forbidden",
  not_found: "not_found",
  conflict: "conflict",
  too_large: "too_large",
  unavailable: "unavailable",
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function categoryJson(c: Category, baseUrl: string) {
  return { id: c.id, name: c.name, slug: c.slug, url: `${baseUrl}/categories/${encodeURIComponent(c.slug)}` };
}

function creatorJson(p: Pick<Publication, "createdBy">, viewer: AgentPrincipal) {
  return {
    name: p.createdBy.name,
    kind: p.createdBy.kind,
    label: p.createdBy.label,
    attribution: attribution(p.createdBy),
    isYou: p.createdBy.userId === viewer.userId,
  };
}

/** Publication list entry: no body, sources, or attachments. */
export function publicationListItemJson(p: PublicationListItem, baseUrl: string, viewer: AgentPrincipal) {
  return {
    id: p.id,
    url: `${baseUrl}${publicationPath(p)}`,
    type: p.type,
    title: p.title,
    summary: p.summary,
    category: categoryJson(p.category, baseUrl),
    tags: p.tags.map((t) => t.name),
    status: p.status,
    revision: p.revision,
    createdBy: creatorJson(p, viewer),
    canUpdate: canUpdatePublication(viewer, p.createdBy.userId),
    createdAt: iso(p.createdAt),
    publishedAt: iso(p.publishedAt),
    updatedAt: iso(p.updatedAt),
  };
}

/** Full publication. `revision` is the value to send as `expectedRevision` in the next update. */
export function publicationJson(p: Publication, baseUrl: string, viewer: AgentPrincipal) {
  return {
    ...publicationListItemJson(p, baseUrl, viewer),
    bodyMarkdown: p.bodyMarkdown,
    sources: p.sources,
    attachmentIds: p.attachmentIds,
    sourcePublishedAt: iso(p.sourcePublishedAt),
  };
}

export function attachmentJson(a: AttachmentInfo) {
  return {
    id: a.id,
    status: a.status,
    mimeType: a.mimeType,
    size: a.size,
    altText: a.altText,
    createdAt: iso(a.createdAt),
    markdown: `![${markdownAlt(a.altText)}](${ATTACHMENT_SCHEME}${a.id})`,
  };
}

/** Alt text safe inside `![...]`. */
function markdownAlt(alt: string) {
  return alt.replace(/[\\[\]]/g, (c) => `\\${c}`).replace(/\s+/g, " ");
}

export function uploadUrl(baseUrl: string, token: string) {
  return `${baseUrl}${UPLOAD_PATH_PREFIX}${encodeURIComponent(token)}`;
}

function success(httpStatus: number, status: BodyStatus, message: string, data: Record<string, unknown>): OperationResult {
  return { httpStatus, body: { status, message, ...data }, isError: false };
}

export function failureResult(f: Failure): OperationResult {
  const body: Body = { status: FAILURE_BODY_STATUS[f.status], message: f.message };
  if (f.errors) body.errors = f.errors;
  if (f.currentRevision !== undefined) body.currentRevision = f.currentRevision;
  return { httpStatus: HTTP_STATUS[f.status], body, isError: true };
}

export function errorResult(httpStatus: number, status: BodyStatus, message: string, extra: Record<string, unknown> = {}): OperationResult {
  return { httpStatus, body: { status, message, ...extra }, isError: true };
}

export function rateLimitedResult(retryAfterSeconds: number, what: string): OperationResult {
  return errorResult(429, "rate_limited", `Too many ${what}. Retry after ${retryAfterSeconds} seconds.`, { retryAfterSeconds });
}

// ---------------------------------------------------------------------------
// Running an operation
// ---------------------------------------------------------------------------

function pageJson<T>(page: Page<T>, map: (item: T) => unknown) {
  return { items: page.items.map(map), total: page.total, page: page.page, pageSize: page.pageSize };
}

const asRecord = (input: unknown): Record<string, unknown> =>
  input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};

async function execute(services: Services, agent: AgentPrincipal, op: OperationName, input: unknown): Promise<OperationResult> {
  const base = services.config.baseUrl;
  switch (op) {
    case "list_categories": {
      const categories = await services.categories.listAll();
      return success(200, "ok", `${categories.length} categories.`, { categories: categories.map((c) => categoryJson(c, base)) });
    }
    case "search_publications": {
      const out = await services.search.agentSearch(agent, input);
      if (!out.ok) return failureResult(out);
      return success(200, "ok", `${out.value.total} matching publications.`, pageJson(out.value, (p) => publicationListItemJson(p, base, agent)));
    }
    case "get_publication": {
      const id = asRecord(input).id;
      const p = typeof id === "string" ? await services.publications.getForAgent(agent, id) : null;
      if (!p) return errorResult(404, "not_found", "Publication not found.");
      return success(200, "ok", "Publication found.", { publication: publicationJson(p, base, agent) });
    }
    case "create_publication": {
      const out = await services.publications.create(agent, input);
      if (!out.ok) return failureResult(out);
      const { publication, replayed } = out.value;
      return replayed
        ? success(200, "replayed", "Already created with this externalId and payload; returning the original.", { publication: publicationJson(publication, base, agent) })
        : success(201, "created", "Published.", { publication: publicationJson(publication, base, agent) });
    }
    case "update_publication": {
      const { id, externalId: _ignored, ...patch } = asRecord(input);
      void _ignored; // externalId cannot change; agents often resend it with the full payload.
      if (typeof id !== "string" || !id) return errorResult(404, "not_found", "Publication not found.");
      const out = await services.publications.update(agent, id, patch);
      if (!out.ok) return failureResult(out);
      return success(200, "updated", `Saved as revision ${out.value.revision}.`, { publication: publicationJson(out.value, base, agent) });
    }
    case "prepare_attachment_upload": {
      const out = await services.attachments.prepareUpload(agent, input);
      if (!out.ok) return failureResult(out);
      const t = out.value;
      return success(201, "created", "Upload the raw bytes with PUT to uploadUrl before it expires, then reference the attachment in Markdown.", {
        attachmentId: t.attachmentId,
        uploadUrl: uploadUrl(base, t.token),
        uploadMethod: "PUT",
        contentType: t.mimeType,
        maxSize: t.maxSize,
        expiresAt: t.expiresAt.toISOString(),
        markdown: `![${markdownAlt(String(asRecord(input).altText ?? "").trim())}](${ATTACHMENT_SCHEME}${t.attachmentId})`,
      });
    }
    case "get_attachment": {
      const id = asRecord(input).id;
      const out = await services.attachments.status(agent, typeof id === "string" ? id : "");
      if (!out.ok) return failureResult(out);
      return success(200, "ok", `Attachment is ${out.value.status}.`, { attachment: attachmentJson(out.value) });
    }
  }
}

export type OperationLog = {
  event: "agent_operation";
  operationId: string;
  interface: "mcp" | "http";
  operation: string;
  userId: string | null;
  credentialKind: string | null;
  credentialId: string | null;
  status: string;
  httpStatus: number;
  durationMs: number;
};

/** One structured log line per operation. Never pass tokens, keys, or request bodies here. */
export function logOperation(entry: Omit<OperationLog, "event">) {
  const line = JSON.stringify({ event: "agent_operation", ...entry } satisfies OperationLog);
  if (entry.httpStatus >= 500) console.error(line);
  else console.log(line);
}

/**
 * Run one agent operation as the authenticated member: write/upload rate limits, the core call, and
 * an operational log line. Role, ownership, and visibility rules are enforced by core.
 */
export async function runOperation(
  services: Services,
  agent: AgentPrincipal,
  op: OperationName,
  input: unknown,
  context: { interface: "mcp" | "http"; operationId: string },
): Promise<OperationResult> {
  const started = Date.now();
  let result: OperationResult;
  try {
    const bucket = OPERATION_BUCKET[op];
    const limited = bucket ? await services.rateLimits.hit(agent.userId, bucket) : { allowed: true as const };
    if (!limited.allowed) {
      result = rateLimitedResult(limited.retryAfterSeconds, bucket === "uploads" ? "upload requests" : "writes");
      if (op === "create_publication" || op === "update_publication") {
        const externalId = asRecord(input).externalId;
        await services.publishingFailures.record({
          operationId: context.operationId,
          userId: agent.userId,
          credentialKind: agent.credentialKind,
          credentialId: agent.credentialId,
          operation: op,
          status: "rate_limited",
          message: result.body.message,
          externalId: typeof externalId === "string" ? externalId : null,
        });
      }
    } else {
      result = await execute(services, agent, op, input);
    }
  } catch (error) {
    console.error(JSON.stringify({ event: "agent_operation_failed", operationId: context.operationId, operation: op, error: String(error) }));
    result = errorResult(503, "unavailable", "Something went wrong on our side. Retry shortly.");
  }
  logOperation({
    operationId: context.operationId,
    interface: context.interface,
    operation: op,
    userId: agent.userId,
    credentialKind: agent.credentialKind,
    credentialId: agent.credentialId,
    status: result.body.status,
    httpStatus: result.httpStatus,
    durationMs: Date.now() - started,
  });
  return result;
}
