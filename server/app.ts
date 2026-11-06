import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider";
import { sql } from "drizzle-orm";
import type { Database } from "./adapters/db";
import type { MediaStore } from "./adapters/media";
import { createMembersRepository } from "./adapters/members-repo";
import { AUTH_BASE_PATH, createAuth, MCP_PATH, type Auth, type GoogleTestOverrides } from "./auth/auth";
import type { AppConfig } from "./config";
import { createMembers, type Members } from "./core/members";
import { planned, type PlannedService } from "./planned";

/**
 * Everything a request needs. Built per request on Workers (including the Better Auth instance);
 * only parsed config is cached. Later stages replace each `PlannedService` with the real service
 * from `server/core/`, wired here.
 */
export interface Services {
  config: AppConfig;
  db: Database;
  auth: Auth;
  media: MediaStore;
  now: () => Date;
  newId: () => string;

  /** Membership gate, current role and status (Stage 0). */
  members: Members;

  // Stage 1: publishing core
  publications: PlannedService<"publications">;
  categories: PlannedService<"categories">;
  tags: PlannedService<"tags">;
  homepage: PlannedService<"homepage">;
  search: PlannedService<"search">;
  attachments: PlannedService<"attachments">;
  markdown: PlannedService<"markdown">;
  audit: PlannedService<"audit">;
  publishingFailures: PlannedService<"publishingFailures">;
  // Lane 2A: agent interfaces
  apiKeys: PlannedService<"apiKeys">;
  agents: PlannedService<"agents">;
  rateLimits: PlannedService<"rateLimits">;
  // Lane 3A: owner console
  invitations: PlannedService<"invitations">;
  // Lane 3B: reader features
  preferences: PlannedService<"preferences">;
  bookmarks: PlannedService<"bookmarks">;
}

export interface HostDeps {
  config: AppConfig;
  db: Database;
  media: MediaStore;
  fetchClientMetadata: ClientMetadataResourceFetch;
  /** Tests inject these. */
  now?: () => Date;
  newId?: () => string;
  /** Tests only: see GoogleTestOverrides. */
  googleTestOverrides?: GoogleTestOverrides;
}

export function createServices(deps: HostDeps): Services {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const members = createMembers({ repo: createMembersRepository(deps.db), ownerEmail: deps.config.ownerEmail, now, newId });
  const auth = createAuth({
    config: deps.config,
    db: deps.db,
    members,
    fetchClientMetadata: deps.fetchClientMetadata,
    googleTestOverrides: deps.googleTestOverrides,
  });

  return {
    config: deps.config,
    db: deps.db,
    auth,
    media: deps.media,
    now,
    newId,
    members,
    publications: planned("publications", "Stage 1"),
    categories: planned("categories", "Stage 1"),
    tags: planned("tags", "Stage 1"),
    homepage: planned("homepage", "Stage 1"),
    search: planned("search", "Stage 1"),
    attachments: planned("attachments", "Stage 1"),
    markdown: planned("markdown", "Stage 1"),
    audit: planned("audit", "Stage 1"),
    publishingFailures: planned("publishingFailures", "Stage 1"),
    apiKeys: planned("apiKeys", "lane 2A"),
    agents: planned("agents", "lane 2A"),
    rateLimits: planned("rateLimits", "lane 2A"),
    invitations: planned("invitations", "lane 3A"),
    preferences: planned("preferences", "lane 3B"),
    bookmarks: planned("bookmarks", "lane 3B"),
  };
}

export type RenderPage = (request: Request, services: Services) => Promise<Response>;

/** Paths that must not be indexed. Public pages stay indexable: no site-wide noindex. */
const PRIVATE_PATH = /^\/(sign-in|consent|dashboard|saved|account|editor|owner|api|mcp)(\/|$)/;

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Dispatch order: /health → Better Auth → /mcp → /api/v1 → /attachments → React Router.
 */
export async function handleRequest(request: Request, services: Services, renderPage: RenderPage): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  let response: Response;

  if (path === "/health") {
    response = await health(services);
  } else if (path === AUTH_BASE_PATH || path.startsWith(`${AUTH_BASE_PATH}/`) || path.startsWith("/.well-known/")) {
    response = await services.auth.handler(request);
  } else if (path === MCP_PATH) {
    response = notYetAvailable("The MCP endpoint is built in lane 2A.");
  } else if (path === "/api/v1" || path.startsWith("/api/v1/")) {
    response = notYetAvailable("The HTTP API is built in lane 2A.");
  } else if ((request.method === "GET" || request.method === "HEAD") && path.startsWith("/attachments/")) {
    // Attachment serving with a visibility check is built in Stage 1 / lane 2B. Nothing is public yet.
    response = Response.json({ status: "not_found", message: "Not found." }, { status: 404, headers: NO_STORE });
  } else {
    response = await renderPage(request, services);
  }

  // Copy so headers are mutable (fetch() responses can have immutable headers).
  const out = new Response(response.body, response);
  if (PRIVATE_PATH.test(path)) out.headers.set("X-Robots-Tag", "noindex");
  return out;
}

function notYetAvailable(message: string) {
  return Response.json({ status: "unavailable", message }, { status: 503, headers: NO_STORE });
}

async function health(services: Services): Promise<Response> {
  const checks = { database: "ok", media: "ok" } as Record<"database" | "media", "ok" | "failed">;
  try {
    await services.db.run(sql`select 1`);
  } catch {
    checks.database = "failed";
  }
  try {
    await services.media.ping();
  } catch {
    checks.media = "failed";
  }
  const ok = checks.database === "ok" && checks.media === "ok";
  return Response.json({ ok, host: services.config.host, checks }, { status: ok ? 200 : 503, headers: NO_STORE });
}
