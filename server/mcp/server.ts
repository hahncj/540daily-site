// The 540 Daily MCP server: six tools over the same operations as the HTTP API.
// A new McpServer is built per request for the authenticated member (stateless).
import { createMcpHandler, fromJsonSchema, McpServer, type JsonSchemaType, type StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AgentPrincipal } from "../agent-auth";
import type { Services } from "../app";
import { MAX_JSON_BODY_BYTES, OPERATION_INPUT_SHAPES, runOperation, type OperationName, type OperationResult } from "../integration";

export const MCP_SERVER_NAME = "540-daily";
export const MCP_SERVER_VERSION = "0.1.0";

export const INSTRUCTIONS = `This is 540 Daily, a public news and research site. You act as the member who connected you, with that member's role.
- Publish stories and reports with create_publication. Always send a unique externalId; resending the same payload with the same externalId is safe and returns the original. A different payload under the same externalId returns a conflict: use update_publication to change it.
- To change one of your publications, call update_publication with expectedRevision set to the revision from your last read. You can only update publications your member created.
- Upload images with prepare_attachment_upload, PUT the raw bytes to the returned uploadUrl, then reference them in Markdown as ![alt text](attachment:ID).
- Every publication needs a category. Pick the category that best fits the content; a new name creates a new category automatically. Any category with recently published items appears on the homepage.
- Failures are tool results with isError true and a status: validation_failed, forbidden, not_found, conflict, too_large, rate_limited, or unavailable.`;

type ToolSpec = {
  op: OperationName;
  title: string;
  description: string;
  readOnly: boolean;
  idempotent: boolean;
};

const TOOLS: ToolSpec[] = [
  {
    op: "list_categories",
    title: "List categories",
    description: "List every category, with its slug for filtering search_publications.",
    readOnly: true,
    idempotent: true,
  },
  {
    op: "search_publications",
    title: "Search publications",
    description:
      "Search published stories and reports by keyword, category slug, type, and America/Chicago publication dates (inclusive). Without q, lists newest first. Also includes your member's own unpublished items. 20 per page.",
    readOnly: true,
    idempotent: true,
  },
  {
    op: "get_publication",
    title: "Read a publication",
    description: "Read one publication by ID, including its Markdown body and current revision. Your member's own unpublished items are readable too.",
    readOnly: true,
    idempotent: true,
  },
  {
    op: "create_publication",
    title: "Publish a story or report",
    description: "Create and immediately publish a story or report. Requires a unique externalId; retries with the same payload return the original.",
    readOnly: false,
    idempotent: true,
  },
  {
    op: "update_publication",
    title: "Update your publication",
    description:
      "Update a publication your member created. Send expectedRevision from your last read and only the fields to change. A stale revision returns a conflict with currentRevision. Updates never change visibility.",
    readOnly: false,
    idempotent: false,
  },
  {
    op: "prepare_attachment_upload",
    title: "Start an image upload",
    description:
      "Start a PNG, JPEG, or WebP upload (at most 10 MiB, alt text required). Returns attachmentId and a short-lived, single-use uploadUrl: PUT the raw bytes there, then use ![alt text](attachment:ID) in bodyMarkdown.",
    readOnly: false,
    idempotent: false,
  },
];

/**
 * The tool's advertised JSON Schema comes from the shared zod shape, but the SDK does not validate it:
 * core validates, so MCP returns the same structured `validation_failed` result as the HTTP API instead
 * of a JSON-RPC error.
 */
function documentedSchema(shape: z.ZodRawShape): StandardSchemaWithJSON<Record<string, unknown>, Record<string, unknown>> {
  const jsonSchema = z.toJSONSchema(z.object(shape), { io: "input", unrepresentable: "any" }) as JsonSchemaType;
  return fromJsonSchema<Record<string, unknown>>(jsonSchema, {
    getValidator: () => (input: unknown) => ({ valid: true, data: (input ?? {}) as never, errorMessage: undefined }),
  });
}

function toolResult(result: OperationResult) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result.body, null, 2) }],
    structuredContent: result.body,
    isError: result.isError,
  };
}

export function createAppMcpServer(services: Services, principal: AgentPrincipal): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION }, { instructions: INSTRUCTIONS });
  for (const tool of TOOLS) {
    server.registerTool(
      tool.op,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: documentedSchema(OPERATION_INPUT_SHAPES[tool.op]),
        annotations: { readOnlyHint: tool.readOnly, destructiveHint: false, idempotentHint: tool.idempotent, openWorldHint: false },
      },
      async (args: Record<string, unknown>) =>
        toolResult(await runOperation(services, principal, tool.op, args, { interface: "mcp", operationId: services.newId() })),
    );
  }
  return server;
}

export function createMcpRequestHandler(services: Services, principal: AgentPrincipal) {
  return createMcpHandler(() => createAppMcpServer(services, principal), { legacy: "stateless", maxRequestBodySize: MAX_JSON_BODY_BYTES });
}
